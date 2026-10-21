import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceAnnouncement } from './chatAnnouncementModel.js';
const row = (id, time, sender_id = 'driver') => ({ id, created_at: `2026-10-14T10:00:${time}Z`, sender_id, body: id });
test('initial history and older pages are silent; new incoming messages announce once', () => {
  let result = advanceAnnouncement(null, [], 'staff');
  result = advanceAnnouncement(result.state, [row('history', '20')], 'staff');
  assert.equal(result.incoming.length, 0);
  result = advanceAnnouncement(result.state, [row('older', '10'), row('history', '20')], 'staff');
  assert.equal(result.incoming.length, 0);
  const messages = [row('history', '20'), row('new', '30')];
  result = advanceAnnouncement(result.state, messages, 'staff');
  assert.deepEqual(result.incoming.map(message => message.id), ['new']);
  result = advanceAnnouncement(result.state, messages, 'staff');
  assert.equal(result.incoming.length, 0);
});
test('outgoing, pending and deleted messages do not announce', () => {
  const baseline = advanceAnnouncement(null, [row('old', '10')], 'staff').state;
  const messages = [row('out', '20', 'staff'), { ...row('pending', '30'), status: 'sending' }, { ...row('deleted', '40'), deleted_at: 'yes' }];
  assert.equal(advanceAnnouncement(baseline, messages, 'staff').incoming.length, 0);
});
