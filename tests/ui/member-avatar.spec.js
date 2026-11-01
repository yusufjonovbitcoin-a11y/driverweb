import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/test-avatar-*.svg', route => /expired|missing/.test(route.request().url())
    ? route.fulfill({ status: 403, body: 'Expired' })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2340"><rect width="1080" height="2340" fill="#4f7ac0"/><circle cx="540" cy="1170" r="350" fill="#eff5ff"/></svg>' }));
});

const avatar = page => page.getByRole('region', { name: 'Avatar recovery' }).locator('.member-avatar');
const image = page => avatar(page).locator('img');

test('portrait images fit the real 44px roster slot without stretching or clipping the frame', async ({ page }) => {
  await page.goto('/tests/ui/member-avatar.html');
  const roster = page.locator('.drivers-roster-person .member-avatar');
  await expect(roster.locator('img')).toBeVisible();
  await expect.poll(() => roster.locator('img').evaluate(img => img.naturalHeight)).toBe(2340);
  const frame = await roster.boundingBox();
  const picture = await roster.locator('img').boundingBox();
  expect(frame.width).toBe(44); expect(frame.height).toBe(44);
  expect(picture.width).toBe(44); expect(picture.height).toBe(44);
  expect(picture.x).toBe(frame.x); expect(picture.y).toBe(frame.y);
});

test('expired avatar signs again once and displays the replacement', async ({ page }) => {
  await page.goto('/tests/ui/member-avatar.html?mode=expired');
  await expect(image(page)).toHaveAttribute('src', '/test-avatar-portrait.svg');
  await expect.poll(() => image(page).evaluate(img => img.naturalWidth)).toBe(1080);
  expect(await page.evaluate(() => window.avatarRenewals)).toEqual(['driver-a']);
});

for (const mode of ['failure', 'invalid-renewal']) test(`unavailable avatar keeps initials without a request loop (${mode})`, async ({ page }) => {
  await page.goto(`/tests/ui/member-avatar.html?mode=${mode}`);
  await expect.poll(() => page.evaluate(() => window.avatarRenewals.length)).toBe(1);
  await expect(image(page)).toHaveCount(0);
  await expect(avatar(page).locator('.member-avatar-initials')).toHaveText('TD');
  await expect(avatar(page).locator('.member-avatar-initials')).toBeVisible();
  await page.getByRole('button', { name: 'Change source' }).click();
  await expect(image(page)).toHaveAttribute('src', '/test-avatar-other.svg');
  await expect(image(page)).toBeVisible();
  expect(await page.evaluate(() => window.avatarRenewals)).toEqual(['driver-a']);
});

test('a late renewal never overwrites another member', async ({ page }) => {
  await page.goto('/tests/ui/member-avatar.html?mode=deferred');
  await expect.poll(() => page.evaluate(() => window.avatarRenewals.length)).toBe(1);
  await page.getByRole('button', { name: 'Change member' }).click();
  await page.evaluate(() => window.finishAvatarRenewal('/test-avatar-portrait.svg'));
  await expect(image(page)).toHaveAttribute('src', '/test-avatar-other.svg');
  await expect(avatar(page).locator('.member-avatar-initials')).toHaveText('SD');
});
