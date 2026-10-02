import test from 'node:test';
import assert from 'node:assert/strict';
import { positionChatContextMenu } from './chatContextMenu.js';

test('keeps the chat context menu inside the viewport', () => {
  assert.deepEqual(positionChatContextMenu({
    x: 990,
    y: 790,
    viewportWidth: 1000,
    viewportHeight: 800,
  }), { left: 762, top: 740 });
  assert.deepEqual(positionChatContextMenu({
    x: -20,
    y: -10,
    viewportWidth: 1000,
    viewportHeight: 800,
  }), { left: 8, top: 8 });
});
