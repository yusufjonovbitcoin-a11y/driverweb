import test from 'node:test';
import assert from 'node:assert/strict';
import { readPushPreferences, pushPreferencesKey, legacyPushPreferenceKey, pushFailureReason } from './webPushPreferences.js';

test('legacy opt-in migrates to both categories, isolated by account', () => {
  const stored = new Map([[legacyPushPreferenceKey('a'), 'true']]);
  const read = key => stored.get(key) ?? null;
  assert.deepEqual(readPushPreferences('a', read), { calls: true, messages: true });
  assert.deepEqual(readPushPreferences('b', read), { calls: false, messages: false });
  assert.deepEqual(readPushPreferences(null, read), { calls: false, messages: false });
});
test('versioned categories override legacy enabled and malformed data fails closed', () => {
  const stored = new Map([[legacyPushPreferenceKey('a'), 'true'], [pushPreferencesKey('a'), '{"calls":true,"messages":false}']]);
  const read = key => stored.get(key) ?? null;
  assert.deepEqual(readPushPreferences('a', read), { calls: true, messages: false });
  stored.set(pushPreferencesKey('a'), 'broken');
  assert.deepEqual(readPushPreferences('a', read), { calls: false, messages: false });
  stored.set(pushPreferencesKey('a'), '{"calls":"true","messages":1}');
  assert.deepEqual(readPushPreferences('a', read), { calls: false, messages: false });
});
test('only safe diagnostic codes reach notification settings, never provider messages', () => {
  for (const code of ['signedOut', 'workerTimeout', 'workerFailed', 'workerProtocol', 'registrationFailed', 'disableFailed']) {
    assert.equal(pushFailureReason(new Error(code)), code);
  }
  assert.equal(pushFailureReason(new Error('private provider response')), 'error');
  assert.equal(pushFailureReason({ code: 'messaging/token-subscribe-failed', message: 'private response' }), 'registrationFailed');
});
