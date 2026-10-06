import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsAllowed, analyticsPage } from './analyticsPolicy.js';
test('only production canonical host records metrics', () => {
  const input = { production: true, hostname: 'driverweb-nine.vercel.app' };
  assert.equal(analyticsAllowed(input), true);
  for (const change of [{ production: false }, { hostname: 'localhost' }, { hostname: 'preview.vercel.app' },
    { preference: 'false' }, { doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    assert.equal(analyticsAllowed({ ...input, ...change }), false);
  }
});
test('only known page names, no arbitrary IDs, auth fragments, search or PII', () => {
  assert.deepEqual(analyticsPage('chat', 'https://example.com'), { page_title: 'T Fleest — chat', page_location: 'https://example.com/#chat', page_referrer: '' });
  for (const input of ['chat?email=private@example.com', 'access_token=secret', 'driver-123', '#profile']) {
    assert.equal(analyticsPage(input, 'https://example.com').page_location, 'https://example.com/#other');
  }
});
