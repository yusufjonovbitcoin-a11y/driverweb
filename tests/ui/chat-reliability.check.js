import { test, expect } from '@playwright/test';

test('long history reaches newest message with actual production latest button, including retry', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/ui/chat-reliability.html');
  await expect(page.getByText('Message 500', { exact: true })).toBeVisible();
  const latest = page.getByRole('button', { name: 'Latest messages' });
  await page.evaluate(() => { window.failNextLatest = true; });
  await latest.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await latest.click();
  await expect(page.getByText('Message 800', { exact: true })).toBeVisible();
  await expect(latest).toHaveCount(0);
  expect(await page.evaluate(() => window.latestAttempts)).toBe(2);
  expect(errors).toEqual([]);
});

test('real WebRTC peers survive a lost signal, ICE restart and simultaneous offers', async ({ page }) => {
  await page.goto('/tests/ui/chat-reliability.html');
  await page.evaluate(() => window.createTestCall({ dropFirstIce: true }));
  const state = () => page.evaluate(() => window.testCall.snapshot());
  try {
    await expect.poll(async () => (await state()).states).toEqual(['connected', 'connected']);
    expect((await state()).iceDropped).toBe(true);
    await page.evaluate(() => window.testCall.send('before restart'));
    await expect.poll(async () => (await state()).received).toBe('before restart');
    const before = (await state()).sdp;
    await page.evaluate(() => window.testCall.restart());
    await expect.poll(async () => (await state()).sdp).not.toBe(before);
    await expect.poll(async () => (await state()).states).toEqual(['connected', 'connected']);
    await page.evaluate(() => window.testCall.simultaneousRestart());
    await expect.poll(async () => (await state()).signaling).toEqual(['stable', 'stable']);
    await expect.poll(async () => (await state()).states).toEqual(['connected', 'connected']);
    await page.evaluate(() => window.testCall.send('after restart'));
    await expect.poll(async () => (await state()).received).toBe('after restart');
    expect((await state()).errors).toEqual([]);
  } finally { await page.evaluate(() => window.testCall.stop()); }
});

test('bounded voice recording produces playable audio and releases its synthetic tracks', async ({ page }) => {
  await page.goto('/tests/ui/chat-reliability.html');
  // A user gesture lets Chromium resume AudioContext; no microphone permission.
  await page.getByRole('heading').click();
  const result = await page.evaluate(() => window.recordSyntheticAudio());
  expect(result.name).toMatch(/\.webm$/);
  expect(result.bytes).toBeGreaterThan(0);
  expect(result.duration).toBeGreaterThan(0.5);
  expect(result.tracksEnded).toBe(true);
});

test('production call UI keeps heartbeat bounded and ends via REST when Realtime misses hangup', async ({ page }) => {
  await page.clock.install();
  await page.goto('/tests/ui/chat-reliability.html?integration');
  await expect(page.getByRole('button', { name: 'Audio call', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Audio call', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.chatBackend.heartbeats)).toBe(1);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => window.chatBackend.heartbeats)).toBe(1);
  await page.clock.fastForward(20000);
  await expect.poll(() => page.evaluate(() => window.chatBackend.heartbeats)).toBe(2);
  await page.evaluate(() => { window.chatBackend.call.status = 'ended'; window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => window.syntheticMic.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await page.clock.fastForward(40000);
  expect(await page.evaluate(() => window.chatBackend.heartbeats)).toBe(2);
});

test('unsupported attachment is rejected visibly before any upload request', async ({ page }) => {
  await page.goto('/tests/ui/chat-reliability.html?integration');
  await expect(page.getByRole('button', { name: 'Audio call', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'sample.gif', mimeType: 'image/gif', buffer: Buffer.from('synthetic') });
  await expect(page.getByText(/JPEG, PNG, WebP/)).toBeVisible();
  expect(await page.evaluate(() => window.chatBackend.uploads)).toBe(0);
});
