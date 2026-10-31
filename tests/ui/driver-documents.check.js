import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const openDocuments = page => page.getByRole('tab', { name: 'Документы', exact: true }).click();

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/driver-documents.html');
  await openDocuments(page);
});

test('one table contains exactly one row per completed load, without expanded file rows', async ({ page }) => {
  await expect(page.locator('.ddr-heading')).toContainText('Рейсов: 2 · Документов: 4');
  await expect(page.locator('.ddr-table')).toHaveCount(1);
  await expect(page.getByRole('columnheader')).toHaveText(['Груз №', 'Маршрут', 'Статус', 'Плановая доставка', 'Документы', 'Действия']);
  await expect(page.locator('.ddr-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.ddr-document-count')).toHaveText(['4', '0']);
  await expect(page.locator('.ddr-table')).not.toContainText('.pdf');
  await expect(page.locator('.ddr-table table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Скачать/ })).toHaveCount(0);
  await expect(page.locator('.driver-document-registry')).not.toContainText('#SECRET');
  await page.locator('.ddr-route').first().click();
  await expect(page.getByLabel('Fixture action')).toContainText('"loadId":"one"');
});

test('filename, type and date searches filter complete load rows and keep the full file count', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Поиск по номеру груза, документу или городу маршрута' });
  await search.fill('delivery 2');
  await expect(page.locator('.ddr-load')).toHaveCount(1);
  await expect(page.locator('.ddr-document-count')).toHaveText('4');
  await search.fill('Транспортная накладная');
  await expect(page.locator('.ddr-load')).toHaveCount(1);
  await search.fill('Hilton');
  await expect(page.locator('.ddr-load')).toHaveCount(2);
  await search.fill('');
  await page.locator('.ddr-tools .workspace-date-trigger').click();
  await page.getByRole('dialog').getByRole('button', { name: '2026-10-02', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(page.locator('.ddr-load')).toHaveCount(1);
  await page.locator('.ddr-tools .workspace-date-trigger').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect(page.locator('.ddr-load')).toHaveCount(2);
  await page.getByRole('button', { name: 'Switch driver', exact: true }).click();
  await openDocuments(page);
  await expect(page.getByRole('searchbox', { name: 'Поиск по номеру груза, документу или городу маршрута' })).toHaveValue('');
  await expect(page.locator('.ddr-table')).toContainText('#SECRET');
  await expect(page.locator('.ddr-table')).not.toContainText('#2536705');
});

test('opening a load with no files still targets that load, and unmatched filters show a clear empty state', async ({ page }) => {
  const empty = page.locator('.ddr-load').filter({ hasText: '#2536706' });
  await expect(empty.locator('.ddr-document-count')).toHaveText('0');
  await empty.locator('.ddr-open-load').click();
  await expect(page.getByLabel('Fixture action')).toContainText('"loadId":"empty"');
  const search = page.getByRole('searchbox', { name: 'Поиск по номеру груза, документу или городу маршрута' });
  await search.fill('no matching document');
  await expect(page.locator('.ddr-table')).toHaveCount(0);
  await expect(page.locator('.driver-document-registry').getByRole('status')).toContainText('По вашему запросу грузы не найдены');
  await search.fill('');
  await expect(page.locator('.ddr-load')).toHaveCount(2);
});

test('the compact table stays contained on mobile and supports keyboard opening in both themes', async ({ page }, testInfo) => {
  await expect(page.locator('.ddr-table td').first()).toHaveCSS('font-size', '14px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  const issues = await new AxeBuilder({ page }).include('.driver-document-registry').analyze();
  expect(issues.violations.filter(issue => ['serious', 'critical'].includes(issue.impact))).toEqual([]);
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await page.locator('.ddr-load-number').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Fixture action')).toContainText('"loadId":"one"');
  await page.screenshot({ path: 'output/driver-documents-' + testInfo.project.name + '.png', fullPage: true });
});
