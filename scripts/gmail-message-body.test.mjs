import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simpleParser } from 'mailparser';
import { extractMessageBody } from './gmail-message-body.mjs';

test('keeps a plain-text email readable without HTML execution', async () => {
  const parsed = await simpleParser('From: broker@example.com\r\nSubject: Load\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Pickup at 08:00</p><script>alert(1)</script>');
  const body = extractMessageBody(parsed);
  assert.match(body.body_text, /Pickup at 08:00/);
  assert.doesNotMatch(body.body_text, /<script>/);
  assert.equal(body.body_truncated, false);
});

test('marks oversized emails as truncated', () => {
  const body = extractMessageBody({ text: 'x'.repeat(300_001) });
  assert.equal(body.body_text.length, 300_000);
  assert.equal(body.body_truncated, true);
});
