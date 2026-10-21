import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Only the isolated fixture and local PDF are allowed; never call real APIs.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/import-review.html');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
});

test('all six sections show real extracted fields and keep the driver selection', async ({ page }) => {
  await page.getByRole('combobox').selectOption('driver-one');
  const panels = [['Route', '25 Example Avenue'], ['Cargo', 'Portable generator'], ['Broker', 'broker@example.invalid'], ['Requirements 2', 'Call before arrival.']];
  for (const [name, content] of panels) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText(content);
    await expect(page.getByRole('combobox')).toHaveValue('driver-one');
    await expect(page.locator('.import-assignment button[type="submit"]')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole('tab', { name: 'Requirements 2', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Overview', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Route', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('2026-10-01');
  await expect(page.getByRole('tabpanel')).toContainText('09:00');
});

test('source PDF renders with page navigation and download', async ({ page }) => {
  await page.getByRole('tab', { name: 'Documents', exact: true }).click();
  await expect(page.locator('.review-document-viewer canvas').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.review-document-viewer')).toContainText('1 of 2');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.review-document-viewer')).toContainText('2 of 2');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Synthetic_Confirmation_TEST-654.pdf');
});

test('duplicate loads stay blocked in every tab', async ({ page }) => {
  await page.goto('/tests/ui/import-review.html?duplicate=1');
  await page.getByRole('combobox').selectOption('driver-one');
  await page.getByRole('tab', { name: 'Broker', exact: true }).click();
  await expect(page.locator('.import-assignment button[type="submit"]')).toBeDisabled();
  await expect(page.locator('.import-assignment [role="alert"]')).toBeVisible();
  await expect(page.getByLabel('Assignment attempts')).toHaveText('0');
});

test('assignment remains guarded and errors stay visible across tabs', async ({ page }) => {
  await page.getByRole('combobox').selectOption('driver-one');
  await page.locator('.import-assignment button[type="submit"]').click();
  await page.getByRole('tab', { name: 'Broker', exact: true }).click();
  await expect(page.getByLabel('Assignment attempts')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveText('Synthetic assignment rejected');
  await expect(page.getByRole('combobox')).toHaveValue('driver-one');
});
