import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMediaRefreshDelay } from './chatMediaExpiry.js';
test('chat media refreshes before provider expiry even if URL was cached', () => {
  assert.equal(chatMediaRefreshDelay('https://api.cloudinary.com/download?expires_at=2000',0,1900000),40000);
  assert.equal(chatMediaRefreshDelay('https://api.cloudinary.com/download?expires_at=2000',0,1990000),0);
});
test('legacy storage URL uses conservative resolution deadline', () => {
  assert.equal(chatMediaRefreshDelay('https://storage.example/file',1000000,1000000),840000);
  assert.equal(chatMediaRefreshDelay('https://storage.example/file',1000000,1900000),0);
  assert.equal(chatMediaRefreshDelay('bad-url',undefined,1900000),0);
});
