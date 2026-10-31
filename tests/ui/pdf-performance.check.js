import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/pdf-performance.html');
});

test('cold PDF renderer starts loading alongside authorization and stays loaded on reopen', async ({ page }) => {
  let moduleRequests = 0, startedDuringAuthorization = false;
  await page.route('**/src/components/PdfDocumentViewer.jsx*', async route => {
    moduleRequests++;
    startedDuringAuthorization = await page.evaluate(() => window.fixtureSourcePending);
    await route.continue();
  });
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
  expect(startedDuringAuthorization).toBe(true);
  expect(moduleRequests).toBe(1);
  expect(await page.evaluate(() => window.fixtureSourceCalls.length)).toBe(1);
  await page.getByRole('button', { name: 'Close PDF', exact: true }).click();
  const previous = await page.evaluate(() => window.fixtureSourceCalls.length);
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
  expect(moduleRequests).toBe(1);
  expect(await page.evaluate(() => window.fixtureSourceCalls.length)).toBe(previous + 1);
  expect(await page.evaluate(() => window.fixtureContentCalls)).toBe(1);
});

test('a stalled PDF download retries once then shows an error instead of an endless spinner', async ({ page }) => {
  await page.goto('/tests/ui/pdf-performance.html?stalled');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureContentCalls)).toBe(2);
  await expect(page.locator('.pdfViewer canvas')).toHaveCount(0);
});

test('a large cold PDF paints its first page through byte ranges before the six-second full response finishes', async ({ page }) => {
  await page.goto('/tests/ui/pdf-performance.html?ranges');
  let ranges = 0;
  page.on('request', request => { if (request.url().includes('/range.pdf') && request.headers().range) ranges++; });
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 4500 });
  expect(ranges).toBeGreaterThan(0);
});

test('a readable first-page preview appears while the original downloads, then yields to the real PDF', async ({ page }) => {
  await page.goto('/tests/ui/pdf-performance.html?preview');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.getByAltText('synthetic.pdf', { exact: true })).toBeVisible({ timeout: 3500 });
  await expect(page.locator('.pdfViewer .page canvas')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Opening original PDF');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByAltText('synthetic.pdf', { exact: true })).toHaveCount(0);
});

test('an expired cached media URL forces one renewal and renders the new PDF', async ({ page }) => {
  await page.goto('/tests/ui/pdf-performance.html?expired');
  let rejected = 0;
  await page.route('**/expired-pdf.pdf', route => { rejected++; return route.fulfill({ status: 403, body: 'Expired URL' }); });
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
  expect(rejected).toBe(1);
  const calls = await page.evaluate(() => window.fixtureSourceCalls);
  expect(calls.some(call => call.forceRefresh)).toBe(true);
  expect(calls.filter(call => call.forceRefresh)).toHaveLength(1);
});

test('a cached renderer never exposes the previous PDF after access is revoked', async ({ page }) => {
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke test permission', exact: true }).click();
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.pdfViewer canvas')).toHaveCount(0);
});
