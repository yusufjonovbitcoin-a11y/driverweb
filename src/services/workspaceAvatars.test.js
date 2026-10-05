import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveWorkspaceAvatars, applyWorkspaceAvatar, hydrateWorkspaceAvatars } from './workspaceAvatars.js';

test('refresh retains matching avatars but never removed or changed paths', () => {
  const old = [{ id: 'a', avatarPath: 'one', avatar: 'valid' }];
  assert.equal(preserveWorkspaceAvatars([{ id: 'a', avatarPath: 'one' }], old)[0].avatar, 'valid');
  for (const avatarPath of ['two', null]) {
    assert.equal(preserveWorkspaceAvatars([{ id: 'a', avatarPath }], old)[0].avatar, undefined);
  }
  assert.deepEqual(preserveWorkspaceAvatars([], old), []);
});

test('late avatar cannot overwrite a different member or updated path', () => {
  const members = [{ id: 'a', avatarPath: 'new' }, { id: 'b', avatarPath: 'old' }];
  assert.deepEqual(applyWorkspaceAvatar(members, { id: 'a', avatarPath: 'old' }, 'stale'), members);
  assert.equal(applyWorkspaceAvatar(members, members[0], 'fresh')[0].avatar, 'fresh');
});

test('slow/failing avatar does not hold back other avatars', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const published = [];
  const members = ['slow', 'failed', 'fast'].map(id => ({ id, avatarPath: id }));
  const pending = hydrateWorkspaceAvatars(members, async member => {
    if (member.id === 'slow') return slow;
    if (member.id === 'failed') throw new Error('network');
    return 'fast-url';
  }, (member, url) => published.push([member.id, url]), () => true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(published, [['fast', 'fast-url']]);
  release('slow-url');
  await pending;
  assert.deepEqual(published, [['fast', 'fast-url'], ['slow', 'slow-url']]);
});

test('invalidated hydration does not publish or start queued requests', async () => {
  let current = true, release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = hydrateWorkspaceAvatars(Array.from({ length: 20 }, (_, id) => ({ id, avatarPath: 'path' })),
    async () => { calls++; await gate; return 'url'; },
    () => assert.fail('stale publish'), () => current);
  assert.equal(calls, 6);
  current = false;
  release();
  await pending;
  assert.equal(calls, 6);
});
