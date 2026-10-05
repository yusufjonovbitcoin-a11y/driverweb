import test from 'node:test';
import assert from 'node:assert/strict';
import { openChatAttachment } from './openChatAttachment.js';

test('opening the same attachment after weeks always requests a fresh URL', async () => {
  const row = { id: 'pdf', mediaUrl: 'https://expired.invalid/old' };
  const opened = []; let requests = 0;
  const open = () => ({ opener: {}, closed: false, location: { replace: (url) => opened.push(url) }, close() {} });
  const resolve = async () => ({ mediaUrl: `https://storage.invalid/fresh-${++requests}` });
  await openChatAttachment(row, resolve, open);
  await openChatAttachment(row, resolve, open);
  assert.equal(requests, 2);
  assert.deepEqual(opened, ['https://storage.invalid/fresh-1', 'https://storage.invalid/fresh-2']);
});

test('failed or revoked signing closes the placeholder and never opens a stale URL', async () => {
  let closed = false; let navigated = false;
  const tab = { opener: {}, close: () => { closed = true; }, location: { replace: () => { navigated = true; } } };
  await assert.rejects(openChatAttachment({ mediaUrl: 'https://old.invalid' }, async () => ({ mediaError: 'revoked' }), () => tab), /revoked/);
  assert.equal(closed, true); assert.equal(navigated, false); assert.equal(tab.opener, null);
  await assert.rejects(openChatAttachment({}, async () => ({}), () => null), /POPUP_BLOCKED/);
  await assert.rejects(openChatAttachment({}, async () => ({ mediaUrl: 'javascript:alert(1)' }), () => tab), /UNAVAILABLE/);
});
