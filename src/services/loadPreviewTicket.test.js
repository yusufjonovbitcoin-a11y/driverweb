import test from 'node:test';
import assert from 'node:assert/strict';
import { issueLoadPreviewTicket, verifyLoadPreviewTicket, verifyLoadPreviewContactsTicket } from '../../supabase/functions/_shared/load-preview-ticket.ts';

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

test('read-only contacts ticket is signed, unexpired and bound to the same actor and company', async () => {
  const candidate = { loadNumber: '42' };
  const ticket = await issueLoadPreviewTicket(candidate, binding, 'server-secret', 1000);
  const owner = { actorId: binding.actorId, companyId: binding.companyId };
  assert.deepEqual(await verifyLoadPreviewContactsTicket(ticket, owner, 'server-secret', 2000), candidate);
  for (const foreign of [{ ...owner, actorId: 'other' }, { ...owner, companyId: 'other' }]) {
    await assert.rejects(verifyLoadPreviewContactsTicket(ticket, foreign, 'server-secret', 2000), /MISMATCHED/);
  }
  await assert.rejects(verifyLoadPreviewContactsTicket({ ...ticket, payload: ticket.payload.replace('42', '99') },
    owner, 'server-secret', 2000), /INVALID/);
  await assert.rejects(verifyLoadPreviewContactsTicket(ticket, owner, 'server-secret', 31 * 60_000), /EXPIRED/);
});
