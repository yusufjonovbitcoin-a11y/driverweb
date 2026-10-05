import test from 'node:test';
import assert from 'node:assert/strict';
import { findPendingBrokerAttachments, shouldProcessExtraction } from './gmail-backlog.mjs';

const now = Date.parse('2026-10-05T12:00:00Z');
function client(tables) {
  return { from(table) {
    let rows = tables[table];
    return { select() { return this; }, eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
      order(key) { rows = [...rows].sort((a,b) => a[key].localeCompare(b[key])); return this; }, limit() { return this; },
      gt(key, value) { rows = rows.filter(row => row[key] > value); return this; },
      then(resolve) { resolve({ data: rows.slice(0, 3) }); } };
  } };
}
test('finds old pending attachment behind more than ten completed ones and honors API caps', async () => {
  const attachments = Array.from({ length: 25 }, (_, index) => ({ id: String(index).padStart(3, '0'),
    company_id: 'c', mime_type: 'application/pdf', created_at: new Date(now + index * 1000).toISOString() }));
  const extractions = attachments.slice(1).map(row => ({ id: row.id, company_id: 'c', attachment_id: row.id, status: 'extracted' }));
  const result = await findPendingBrokerAttachments(client({ broker_attachments: attachments, ai_extractions: extractions }), 'c', ['application/pdf']);
  assert.deepEqual(result.map(row => row.id), ['000']);
});
test('failed/invalid provider requests back off and cannot starve later attachments', async () => {
  const attachments = ['a','b'].map(id => ({ id, company_id: 'c', mime_type: 'application/pdf', created_at: '2026-10-01', ai_last_attempt_at: id === 'a' ? new Date(now).toISOString() : null }));
  const result = await findPendingBrokerAttachments(client({ broker_attachments: attachments, ai_extractions: [] }), 'c', ['application/pdf'], 1, now);
  assert.equal(result[0].id, 'b');
});
test('review/completed work is never rerun, failed work retries only after cooldown', () => {
  assert.equal(shouldProcessExtraction({ status: 'needs_review' }, { retryFailed: true, now }), false);
  assert.equal(shouldProcessExtraction({ status: 'parse_failed', processed_at: new Date(now).toISOString() }, { retryFailed: true, now }), false);
  assert.equal(shouldProcessExtraction({ status: 'parse_failed', processed_at: new Date(now - 1800001).toISOString() }, { retryFailed: true, now }), true);
});
