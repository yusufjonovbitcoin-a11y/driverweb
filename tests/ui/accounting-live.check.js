import { test, expect } from '@playwright/test';

test('accounting uses supplied records, has no demo entry and removes only the retired test database', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/accounting-live.html?accountingDemo=1');
  await expect(page.getByRole('tab', { name: 'Driver settlements', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);
  await expect(page.locator('.ds-workspace')).not.toContainText('DEMO');
  await expect(page.locator('tbody')).toContainText('LOAD-42');
  await expect(page.locator('.ds-net strong')).toHaveText('$4,348.50');
  await expect(page.getByRole('button', { name: 'PDF · review and confirm', exact: true })).toBeEnabled();
  await expect.poll(async () => page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'tfleets-accounting-demo-v1'))).toBe(false);
  await expect(page).not.toHaveURL(/accountingDemo/);
  await page.getByRole('tab', { name: 'Confirmed loads', exact: true }).click();
  await expect(page.locator('.ds-workspace')).not.toContainText('Alex Morgan');
  await expect(page.locator('.ds-history-empty')).toBeVisible();
});
