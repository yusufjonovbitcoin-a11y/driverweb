import assert from 'node:assert/strict';
import test from 'node:test';
import { mapFailureState } from './mapHealth.js';

test('a post-load resource error leaves route and live updates enabled', () => {
  assert.deepEqual(mapFailureState(true), { status: 'ready', resourceError: true });
});
test('initialization failures use a recoverable blocking state', () => {
  assert.deepEqual(mapFailureState(false), { status: 'error', resourceError: false });
});
