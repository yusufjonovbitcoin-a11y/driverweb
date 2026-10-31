import { test, expect } from '@playwright/test';

const openMenu = page => page.locator('.drivers-roster-more > button').click();
const suspend = page => page.getByRole('button', { name: 'Приостановить аккаунт', exact: true });
const suspendedTab = page => page.locator('.drivers-roster-tabs').getByRole('button', { name: /Приостановлен/ });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('admin suspends and reactivates the same driver from the menu; counts and assignment update', async ({ page }) => {
  await page.goto('/tests/ui/driver-roster-status.html');
  await openMenu(page);
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Test Driver'); await dialog.accept(); });
  await suspend(page).click();
  await expect(suspendedTab(page)).toHaveText('Приостановлен (1)');
  await expect(page.locator('.drivers-roster-notice')).toHaveText('Статус аккаунта изменён');
  await expect(page.getByLabel('Fixture action')).toBeEmpty();
  await suspendedTab(page).click();
  await openMenu(page);
  await expect(page.getByRole('button', { name: 'Назначить груз', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Активировать аккаунт', exact: true }).click();
  await expect(suspendedTab(page)).toHaveText('Приостановлен (0)');
  await page.locator('.drivers-roster-tabs').getByRole('button', { name: 'Все (1)', exact: true }).click();
  await openMenu(page);
  await expect(page.getByRole('button', { name: 'Назначить груз', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.statusRequests)).toEqual([{ id: 'fixture-driver', status: 'suspended' }, { id: 'fixture-driver', status: 'active' }]);
});

test('cancel does not mutate, Escape closes menu, row remains keyboard accessible', async ({ page }) => {
  await page.goto('/tests/ui/driver-roster-status.html');
  await openMenu(page);
  page.once('dialog', dialog => dialog.dismiss());
  await suspend(page).click();
  expect(await page.evaluate(() => window.statusRequests)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(suspend(page)).toHaveCount(0);
  await page.locator('tbody tr').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Fixture action')).toHaveText('driver');
});

test('failure keeps the driver active and permits retry', async ({ page }) => {
  await page.goto('/tests/ui/driver-roster-status.html?mode=error');
  await openMenu(page);
  page.on('dialog', dialog => dialog.accept());
  await suspend(page).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось');
  await expect(suspendedTab(page)).toHaveText('Приостановлен (0)');
  await expect(suspend(page)).toBeEnabled();
  await page.evaluate(() => { window.statusMode = ''; });
  await suspend(page).click();
  await expect(suspendedTab(page)).toHaveText('Приостановлен (1)');
});

test('pending status change prevents duplicate submissions', async ({ page }) => {
  await page.goto('/tests/ui/driver-roster-status.html?mode=deferred');
  await openMenu(page);
  page.once('dialog', dialog => dialog.accept());
  await suspend(page).click();
  await expect(suspend(page)).toBeDisabled();
  await expect(suspend(page)).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Назначить груз', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.statusRequests.length)).toBe(1);
  await page.evaluate(() => window.finishStatusRequest());
  await expect(suspendedTab(page)).toHaveText('Приостановлен (1)');
});

test('dispatchers cannot suspend; unknown account states cannot be changed', async ({ page }) => {
  for (const query of ['role=dispatcher', 'status=pending']) {
    await page.goto(`/tests/ui/driver-roster-status.html?${query}`);
    await openMenu(page);
    await expect(suspend(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Активировать аккаунт', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.statusRequests)).toEqual([]);
  }
});

test('successful mutation with failed refresh reports saved state separately', async ({ page }) => {
  await page.goto('/tests/ui/driver-roster-status.html?mode=refresh-error');
  await openMenu(page);
  page.once('dialog', dialog => dialog.accept());
  await suspend(page).click();
  await expect(page.getByRole('alert')).toContainText('Изменения сохранены');
  expect(await page.evaluate(() => window.savedDriverStatus)).toBe('suspended');
  expect(await page.evaluate(() => window.statusRequests.length)).toBe(1);
});
