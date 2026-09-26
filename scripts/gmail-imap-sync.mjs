import dotenv from 'dotenv';
import { normalizeMessageLimit, selectPendingUids } from './gmail-sync-cursor.mjs';
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: process.env.GMAIL_ENV_FILE || '.env.gmail' });

const required = ['GMAIL_IMAP_USER', 'GMAIL_IMAP_APP_PASSWORD', 'GMAIL_COMPANY_ID', 'GMAIL_WORKER_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}

const mailboxEmail = process.env.GMAIL_IMAP_USER.trim().toLowerCase();
const companyId = process.env.GMAIL_COMPANY_ID.trim();
const maxMessages = normalizeMessageLimit(process.env.GMAIL_MAX_MESSAGES || 25);
const supportedAttachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const mimeTypeByExtension = new Map([
  ['.pdf', 'application/pdf'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const extensionByMimeType = new Map([...mimeTypeByExtension].map(([extension, mimeType]) => [mimeType, extension]));
const admin = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function safeFileName(name) {
  return String(name || 'attachment.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'attachment.pdf';
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function uploadWorkerMedia({ content, fileName, mimeType, scope, contextId, fallbackPath }) {
  const form = new FormData();
  form.set('companyId', companyId);
  form.set('scope', scope);
  if (contextId) form.set('contextId', contextId);
  form.set('file', new Blob([content], { type: mimeType }), fileName);
  const response = await fetch(`${process.env.SUPABASE_URL.trim()}/functions/v1/cloudinary-media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY.trim()}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      'X-Worker-Token': process.env.GMAIL_WORKER_TOKEN.trim(),
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.reference) {
    if (String(process.env.CLOUDINARY_REQUIRED || '').toLowerCase() === 'true') {
      throw new Error(payload.error || `Cloudinary upload failed with ${response.status}`);
    }
    const { error } = await admin.storage.from('broker-originals').upload(fallbackPath, content, {
      contentType: mimeType,
      upsert: true,
    });
    if (error) throw error;
    return fallbackPath;
  }
  return payload.reference;
}

function supportedMimeType(attachment) {
  if (supportedAttachmentTypes.has(attachment.contentType)) return attachment.contentType;
  const lowerName = String(attachment.filename || '').toLowerCase();
  return [...mimeTypeByExtension.entries()].find(([extension]) => lowerName.endsWith(extension))?.[1] || null;
}

async function processBrokerAttachment(attachmentId) {
  const { data: existing, error: existingError } = await admin
    .from('ai_extractions')
    .select('status')
    .eq('attachment_id', attachmentId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (['extracted', 'needs_review', 'parse_failed'].includes(existing?.status)) {
    return { processed: false, status: existing.status };
  }

  const response = await fetch(`${process.env.SUPABASE_URL.trim()}/functions/v1/process-broker-attachment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY.trim()}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      'X-Worker-Token': process.env.GMAIL_WORKER_TOKEN.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attachmentId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI worker failed with ${response.status}`);
  return { processed: true, status: payload.status || 'extracted' };
}

async function processPendingBrokerAttachments(limit = 10) {
  const { data: attachments, error } = await admin
    .from('broker_attachments')
    .select('id')
    .eq('company_id', companyId)
    .in('mime_type', [...supportedAttachmentTypes])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  let processed = 0;
  let failed = 0;
  for (const attachment of attachments || []) {
    try {
      const result = await processBrokerAttachment(attachment.id);
      if (result.processed) processed += 1;
    } catch (processingError) {
      failed += 1;
      console.error(`AI backlog extraction failed for attachment ${attachment.id}:`, processingError.message);
    }
  }
  return { processed, failed };
}

async function getConnection() {
  const { data: connection, error } = await admin
    .from('gmail_connections')
    .select('id,provider_history_id')
    .eq('company_id', companyId)
    .eq('mailbox_email', mailboxEmail)
    .maybeSingle();
  if (error) throw error;
  if (connection) return connection;

  const { data: creator, error: creatorError } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', companyId)
    .in('role', ['company_admin', 'dispatcher'])
    .eq('status', 'active')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (creatorError || !creator) throw new Error('Active dispatcher or company admin was not found');

  const { data: created, error: createError } = await admin
    .from('gmail_connections')
    .upsert({
      company_id: companyId,
      mailbox_email: mailboxEmail,
      secret_reference: 'env:GMAIL_IMAP_APP_PASSWORD',
      created_by: creator.id,
      status: 'active',
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    .select('id,provider_history_id')
    .single();
  if (createError) throw createError;
  return created;
}

async function ingestMessage(connectionId, message) {
  const parsed = await simpleParser(message.source);
  const providerMessageId = parsed.messageId || `imap:${mailboxEmail}:${message.uid}`;
  const receivedAt = (parsed.date || message.envelope?.date || new Date()).toISOString();
  const rawPath = await uploadWorkerMedia({
    content: message.source,
    fileName: `${message.uid}.eml`,
    mimeType: 'message/rfc822',
    scope: 'gmail_raw',
    contextId: connectionId,
    fallbackPath: `${companyId}/gmail/raw/${message.uid}.eml`,
  });

  const fromEmail = parsed.from?.value?.[0]?.address || message.envelope?.from?.[0]?.address || mailboxEmail;
  const { data: messageId, error: messageError } = await admin.rpc('ingest_broker_message', {
    company_id: companyId,
    gmail_connection_id: connectionId,
    provider_message_id: providerMessageId,
    provider_thread_id: parsed.inReplyTo || null,
    from_email: fromEmail,
    subject: parsed.subject || null,
    received_at: receivedAt,
    raw_storage_path: rawPath,
  });
  if (messageError || !messageId) throw messageError || new Error('Broker message was not created');

  let documentCount = 0;
  let processedCount = 0;
  let failedCount = 0;
  for (const attachment of parsed.attachments || []) {
    const mimeType = supportedMimeType(attachment);
    if (!mimeType || !attachment.content?.length) continue;
    const digest = checksum(attachment.content);
    const fileName = safeFileName(attachment.filename || `attachment${extensionByMimeType.get(mimeType) || ''}`);
    const storagePath = await uploadWorkerMedia({
      content: attachment.content,
      fileName,
      mimeType,
      scope: 'broker_original',
      contextId: messageId,
      fallbackPath: `${companyId}/gmail/${messageId}/${digest}-${fileName}`,
    });
    const { error: attachmentError } = await admin.from('broker_attachments').upsert({
      company_id: companyId,
      message_id: messageId,
      file_name: fileName,
      mime_type: mimeType,
      storage_path: storagePath,
      checksum_sha256: digest,
      size_bytes: attachment.content.length,
    }, { onConflict: 'message_id,checksum_sha256', ignoreDuplicates: true });
    if (attachmentError) throw attachmentError;
    const { data: savedAttachment, error: savedAttachmentError } = await admin
      .from('broker_attachments')
      .select('id')
      .eq('message_id', messageId)
      .eq('checksum_sha256', digest)
      .single();
    if (savedAttachmentError) throw savedAttachmentError;
    try {
      const processing = await processBrokerAttachment(savedAttachment.id);
      if (processing.processed) processedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`AI extraction failed for attachment ${savedAttachment.id}:`, error.message);
    }
    documentCount += 1;
  }
  if ((parsed.attachments || []).length > 0 && documentCount === 0) {
    const attachmentTypes = [...new Set(parsed.attachments.map((attachment) => (
      attachment.contentType || 'noma\u2019lum format'
    )))].join(', ');
    await admin.from('broker_messages').update({
      status: 'needs_review',
      error_message: `PDF yoki surat topilmadi. Biriktirma turi: ${attachmentTypes}`,
    }).eq('id', messageId);
  }
  return { documentCount, processedCount, failedCount };
}

const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user: mailboxEmail, pass: process.env.GMAIL_IMAP_APP_PASSWORD },
  logger: false,
});

try {
  const connection = await getConnection();
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  let synced = 0;
  let documents = 0;
  let processed = 0;
  let failed = 0;
  let lastUid = Number(connection.provider_history_id || 0);
  try {
    const candidates = lastUid > 0
      ? await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
      : await client.search({ seen: false }, { uid: true });
    const pendingUids = selectPendingUids(candidates, lastUid, maxMessages);
    const messages = pendingUids.length
      ? client.fetch(pendingUids, { uid: true, source: true, envelope: true }, { uid: true })
      : [];
    for await (const message of messages) {
      const result = await ingestMessage(connection.id, message);
      lastUid = Math.max(lastUid, Number(message.uid));
      synced += 1;
      documents += result.documentCount;
      processed += result.processedCount;
      failed += result.failedCount;
    }
  } finally {
    lock.release();
  }
  const { error: checkpointError } = await admin.from('gmail_connections').update({
    status: 'active',
    last_error: null,
    last_synced_at: new Date().toISOString(),
    provider_history_id: lastUid ? String(lastUid) : connection.provider_history_id,
  }).eq('id', connection.id);
  if (checkpointError) throw checkpointError;
  const backlog = await processPendingBrokerAttachments();
  processed += backlog.processed;
  failed += backlog.failed;
  console.log(JSON.stringify({ synced, documents, processed, failed }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.logout().catch(() => {});
}
