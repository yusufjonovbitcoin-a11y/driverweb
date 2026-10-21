import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/profile-settings.html');
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('top tabs support manual keyboard activation and open section headings below sticky navigation', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Profile sections' });
  await expect(tabs.getByRole('tab')).toHaveCount(7);
  await page.getByRole('tab', { name: 'General', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'profile-tab-company');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.locator('.workspace-main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const personal = page.getByRole('tab', { name: 'Personal details', exact: true });
  await personal.click();
  await expect(personal).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await personal.getAttribute('id'));
  await expect.poll(async () => {
    const heading = await page.locator('.profile-section-heading').first().boundingBox();
    const navigation = await tabs.boundingBox();
    return heading.y >= navigation.y + navigation.height - 1;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('company edit opens the existing form and saves through the existing callback', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Personal details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Full name', { exact: true }).fill('Updated Admin');
  await page.getByLabel('Company', { exact: true }).fill('Updated Transport');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Profile saves')).toHaveText('1');
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated Transport', exact: true })).toBeVisible();
});

test('regional controls keep working and integrations remain admin-only', async ({ page }) => {
  await page.getByLabel('Language', { exact: true }).selectOption('uz');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('uz');
  await page.getByLabel('Time zone', { exact: true }).selectOption('America/Denver');
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/Denver');
  await page.getByRole('button').filter({ hasText: 'Interface' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/tests/ui/profile-settings.html?role=dispatcher');
  await expect(page.getByRole('tab', { name: 'Integrations', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(6);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveAttribute('readonly', '');
});
