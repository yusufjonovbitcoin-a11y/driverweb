import { test, expect } from '@playwright/test';

const workspace = '/tests/ui/workspace-route.html';

test('refresh and browser history restore a driver and a load section', async ({ page }) => {
  await page.goto(`${workspace}#drivers`);
  await page.getByText('Route Test Driver', { exact: true }).click();
  const trips = page.getByRole('tab', { name: 'Trips', exact: true });
  const documents = page.getByRole('tab', { name: 'Documents', exact: true });
  await documents.click();
  await page.reload();
  await expect(documents).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(trips).toHaveAttribute('aria-selected', 'true');
  await page.locator('.driver-trip-card').filter({ hasText: 'ROUTE-101' }).click();
  const loadDialog = page.getByRole('dialog', { name: /ROUTE-101/ });
  const route = loadDialog.getByRole('tab', { name: 'Route', exact: true });
  await route.click();
  await page.reload();
  await expect(route).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(loadDialog.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(route).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(loadDialog).toHaveCount(0);
  await page.reload();
  await expect(trips).toHaveAttribute('aria-selected', 'true');
  await expect(loadDialog).toHaveCount(0);
});

test('invalid route IDs and sections fall back to an available view', async ({ page }) => {
  await page.goto(`${workspace}#drivers?driver=missing&load=route-load`);
  await expect(page.getByText('Route Test Driver', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /ROUTE-101/ })).toHaveCount(0);
  await page.goto(`${workspace}#drivers?driver=route-driver&section=missing&load=missing`);
  await expect(page.getByRole('tab', { name: 'Trips', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog', { name: /ROUTE-101/ })).toHaveCount(0);
});

test('accounting and analytics restore their selected sections', async ({ page }) => {
  await page.goto(`${workspace}#accounting`);
  const settings = page.getByRole('tab', { name: 'Calculation settings' });
  await settings.click();
  await page.reload();
  await expect(settings).toHaveAttribute('aria-selected', 'true');

  await page.goto(`${workspace}#analytics`);
  await page.locator('.fc-nav').getByRole('button', { name: 'Loads', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Load financial register' })).toBeVisible();
});

test('refresh shows the driver and restored load before slow document checks finish', async ({ page }) => {
  const target = `${workspace}?reviews=held#drivers?driver=route-driver&load=route-load&loadSection=overview`;
  await page.goto(target);
  const dialog = page.getByRole('dialog', { name: /ROUTE-101/ });
  await expect(dialog).toBeVisible();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => window.releaseWorkspaceReviews());
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(target);
});

test('pending or unavailable document checks do not hide the workspace or claim success', async ({ page }) => {
  await page.goto(`${workspace}?reviews=held#docs`);
  await expect(page.getByText('Loading document checks…', { exact: true })).toBeVisible();
  await expect(page.getByText('ROUTE-101', { exact: true })).toBeVisible();
  await expect(page.getByText('AI check passed', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.releaseWorkspaceReviews('error'));
  await expect(page.getByText('Document check results unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('ROUTE-101', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Loading document checks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.releaseWorkspaceReviews());
  await expect(page.getByText('Loading document checks…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Document check results unavailable', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ROUTE-101', { exact: true })).toBeVisible();
});
