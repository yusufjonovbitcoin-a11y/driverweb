import test from 'node:test';
import assert from 'node:assert/strict';
import { issueLoadPreviewTicket, verifyLoadPreviewTicket } from '../../supabase/functions/_shared/load-preview-ticket.ts';

const binding = { actorId: 'actor', companyId: 'company', checksum: 'abc',
  fileName: 'rate.pdf', mimeType: 'application/pdf', version: 17 };

test('an unchanged browser-held preview can be finalized once its original file matches', async () => {
  const candidate = { loadNumber: '42', stops: [{ role: 'pickup' }, { role: 'delivery' }] };
  const ticket = await issueLoadPreviewTicket(candidate, binding, 'server-secret', 1000);
  assert.deepEqual(await verifyLoadPreviewTicket(ticket, binding, 'server-secret', 2000), candidate);
});

test('edited, foreign and expired previews cannot be finalized', async () => {
  const ticket = await issueLoadPreviewTicket({ loadNumber: '42' }, binding, 'server-secret', 1000);
  await assert.rejects(verifyLoadPreviewTicket({ ...ticket, payload: ticket.payload.replace('42', '99') },
    binding, 'server-secret', 2000), /PREVIEW_TICKET_INVALID/);
  await assert.rejects(verifyLoadPreviewTicket(ticket, { ...binding, checksum: 'different' },
    'server-secret', 2000), /PREVIEW_TICKET_EXPIRED_OR_MISMATCHED/);
  await assert.rejects(verifyLoadPreviewTicket(ticket, binding, 'server-secret', 31 * 60_000),
    /PREVIEW_TICKET_EXPIRED_OR_MISMATCHED/);
});
