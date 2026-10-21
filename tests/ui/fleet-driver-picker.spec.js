import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/fleet-driver-picker.html');
});

test('driver cards search by truck and selection updates the value and restores focus', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Driver: Amin Test', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Choose a driver' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(panel.getByRole('button', { pressed: true })).toContainText('Amin Test');
  await page.getByRole('searchbox').fill('T-159');
  await expect(panel.getByRole('button')).toHaveCount(1);
  await panel.getByRole('button', { name: /Driver 59/ }).click();
  await expect(page.getByLabel('Selected driver')).toHaveText('driver-59');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Driver: Driver 59', exact: true })).toBeFocused();
});

test('keyboard supports arrows, Home/End, Escape, Enter and Tab dismissal', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Driver: Amin Test', exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  const search = page.getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  const first = page.getByRole('dialog').getByRole('button').first();
  const last = page.getByRole('dialog').getByRole('button').last();
  await expect(first).toBeFocused();
  await first.press('End');
  await expect(last).toBeFocused();
  await last.press('Home');
  await expect(first).toBeFocused();
  await first.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill('T-123');
  await search.press('Enter');
  await expect(page.getByLabel('Selected driver')).toHaveText('driver-23');
  await page.getByRole('button', { name: 'Driver: Driver 23', exact: true }).click();
  await search.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'After picker' })).toBeFocused();
});

test('empty search results recover and outside clicks dismiss without changing driver', async ({ page }) => {
  await page.getByRole('button', { name: 'Driver: Amin Test', exact: true }).click();
  await page.getByRole('searchbox').fill('unknown-driver');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('No matching drivers');
  await page.getByRole('searchbox').fill('');
  await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(60);
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByLabel('Selected driver')).toHaveText('driver-0');
  await page.goto('/tests/ui/fleet-driver-picker.html?empty=1');
  await expect(page.getByRole('button', { name: 'Driver: No drivers found', exact: true })).toBeDisabled();
});

test('trigger toggles closed and the popup stays above a reduced visual viewport', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const trigger = page.getByRole('button', { name: 'Driver: Amin Test', exact: true });
  await trigger.click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 300 });
    window.visualViewport.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
  });
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(11);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(289);
  expect(errors).toEqual([]);
});
