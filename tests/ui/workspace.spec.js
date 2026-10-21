import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  // No production/network access is permitted from this fixture.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/index.html');
});
for (const modal of ['quick', 'contact', 'vehicle']) {
  test(`${modal} dialog contains keyboard focus and restores its opener`, async ({ page }) => {
    const opener = page.getByRole('button', { name: `Open ${modal}`, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    // Traverse more controls than any fixture modal contains, in both directions.
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
test('logout and unread count remain accessible at both viewport sizes', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Chat, 3 unread/ })).toBeVisible();
  const logout = page.getByRole('button', { name: /Sign out|Log out/ });
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Signed out' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('history is silent, new incoming message gets a polite announcement', async ({ page }) => {
  const announcement = page.locator('[aria-live="polite"]');
  await expect(announcement).toBeEmpty();
  await page.getByRole('button', { name: 'Receive test message' }).click();
  await expect(announcement).toHaveText('New message: Arrival 1');
});
test('synthetic workspace has no serious or critical automated accessibility violations', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Toggle theme' }).click();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.filter(issue => ['serious', 'critical'].includes(issue.impact))).toEqual([]);
  }
});
test('source viewer owns focus over the assignment dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Open quick', exact: true }).click();
  const source = page.getByRole('button', { name: /Original|Source/i });
  await source.click();
  const viewer = page.locator('[aria-labelledby="document-viewer-title"]');
  await expect(viewer).toBeVisible();
  for (let i=0; i<12; i++) {
    await page.keyboard.press('Tab');
    expect(await viewer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(source).toBeFocused();
});
