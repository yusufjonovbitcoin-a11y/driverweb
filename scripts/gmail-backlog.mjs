import { readAllRows, mapWithConcurrency } from '../src/services/readAllRows.js';

const FAILED_RETRY_MS = 30 * 60_000;

export function shouldProcessExtraction(extraction, { retryFailed = false, now = Date.now() } = {}) {
  if (['extracted', 'needs_review'].includes(extraction?.status)) return false;
  if (extraction?.status !== 'parse_failed') return true;
  const attemptedAt = Date.parse(extraction.processed_at);
  return retryFailed && (!Number.isFinite(attemptedAt) || now - attemptedAt >= FAILED_RETRY_MS);
}

// Filter completed work BEFORE applying the processing limit. Scanning immutable
// IDs also survives API row caps and never repeatedly retries only the newest10.
export async function findPendingBrokerAttachments(admin, companyId, mimeTypes, limit = 10, now = Date.now()) {
  const attachments = await readAllRows(() => admin.from('broker_attachments')
    .select('id,created_at,ai_last_attempt_at').eq('company_id', companyId).in('mime_type', mimeTypes));
  const batches = [];
  for (let offset = 0; offset < attachments.length; offset += 100) batches.push(attachments.slice(offset, offset + 100));
  const extractions = (await mapWithConcurrency(batches, batch => readAllRows(() => admin.from('ai_extractions')
    .select('id,attachment_id,status,processed_at').eq('company_id', companyId)
    .in('attachment_id', batch.map(row => row.id))), 3)).flat();
  const byAttachment = new Map(extractions.map(row => [row.attachment_id, row]));
  return attachments.filter(row => {
    const lastAttempt = Date.parse(row.ai_last_attempt_at);
    return (!Number.isFinite(lastAttempt) || now - lastAttempt >= FAILED_RETRY_MS)
      && shouldProcessExtraction(byAttachment.get(row.id), { retryFailed: true, now });
  }).sort((a, b) => String(a.ai_last_attempt_at || a.created_at).localeCompare(String(b.ai_last_attempt_at || b.created_at)) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
