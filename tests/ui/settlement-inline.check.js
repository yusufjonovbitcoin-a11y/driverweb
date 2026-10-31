import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extractText } from 'unpdf';

test('edit PDF values in place, cancel safely, approve and reopen the identical exported amounts', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/settlement-inline.html');
  const hotspot = name => page.getByRole('button', { name: 'Edit PDF: ' + name, exact: true });
  await expect(hotspot('Company name')).toBeVisible();
  await expect(page.locator('.ds-pdf-editor')).toHaveCount(0);
  await hotspot('Driver').click();
  await page.getByLabel('Driver', { exact: true }).fill('Updated driver');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.ds-pdf-inline-editor')).toHaveCount(0);
  await hotspot('Driver').click();
  await expect(page.getByLabel('Driver', { exact: true })).toHaveValue('Alex Morgan · DEMO');
  await page.keyboard.press('Escape');

  await hotspot('Load Net · DEMO-1001').click();
  await page.getByLabel('Load Net', { exact: true }).fill('5000.01');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await page.locator('.ds-pdf-inline-editor').getByRole('button', { name: 'Apply to PDF', exact: true }).click();
  await expect(hotspot('Final Net')).toBeVisible();
  await hotspot('Final Net').click();
  await page.getByLabel('Final Net', { exact: true }).fill('8000.25');
  await page.locator('.ds-pdf-inline-editor').getByRole('button', { name: 'Apply to PDF', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();

  await hotspot('Final Net').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('inline-pdf.png') });
  await hotspot('Final Net').click();
  await expect(page.getByLabel('Final Net', { exact: true })).toHaveValue('8000.25');
  await page.screenshot({ path: testInfo.outputPath('inline-editor.png') });
  const popup = await page.locator('.ds-pdf-inline-editor').boundingBox();
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.y + popup.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByLabel('Approved Net')).toHaveText('800025');
  await page.getByRole('button', { name: 'Reopen approved PDF' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  await expect(page.locator('.ds-pdf-hotspot')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  const text = (await extractText(new Uint8Array(await readFile(await download.path())), { mergePages: true })).text;
  expect(text).toContain('5,000.01');
  expect(text).toContain('8,000.25');
  expect(text).toContain('Final Net adjustment');
  expect(errors).toEqual([]);
});

test('zoom keeps PDF fields aligned and editing a fee recalculates the exported settlement', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/settlement-inline.html');
  await expect(page.getByRole('button', { name: 'Edit PDF: Company name', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Edit PDF: Gross · DEMO-1001', exact: true }).click();
  await page.getByLabel('Gross', { exact: true }).fill('6300');
  await page.locator('.ds-pdf-inline-editor').getByRole('button', { name: 'Apply to PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit to width', exact: true })).toHaveText('125%');
  await page.getByRole('button', { name: 'Edit PDF: Truck & cargo insurance', exact: true }).click();
  await page.getByRole('spinbutton').fill('400');
  await page.locator('.ds-pdf-inline-editor').getByRole('button', { name: 'Apply to PDF', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  const text = (await extractText(new Uint8Array(await readFile(await download.path())), { mergePages: true })).text;
  expect(text).toContain('6,300.00');
  expect(text).toContain('8,057.50');
  expect(text).toContain('400.00');
});

test('PDF delivery shows failures, retries the current approved PDF and reports success only after acknowledgement', async ({ page }, testInfo) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/settlement-inline.html?delivery');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen approved PDF' }).click();
  const send = page.getByRole('button', { name: 'Send to driver', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('alert')).toContainText('PDF was not sent');
  await expect(page.getByLabel('Delivery attempts')).toHaveText('1');
  await expect(page.getByLabel('Delivered Net')).toHaveText('');
  await send.click();
  await expect(page.getByRole('button', { name: 'Sent', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Delivery attempts')).toHaveText('2');
  await expect(page.getByLabel('Delivered Net')).toHaveText('721250');
  await expect(page.locator('.ds-delivery-status')).toContainText('Settings → Earnings');
  await expect(page.locator('.pdfViewer .page canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('earnings-delivery.png') });
});

test('demo PDFs visibly disable delivery to a real driver', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/settlement-inline.html?delivery&demo');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen approved PDF' }).click();
  await expect(page.getByRole('button', { name: 'Send to driver', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Delivery attempts')).toHaveText('0');
});
