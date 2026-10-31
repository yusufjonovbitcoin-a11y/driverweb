import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const popup = page => page.locator('[data-workspace-calendar]');
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/calendar.html');
});
test('range selection uses the reference calendar, applies once, reverses ranges and clears', async ({ page }) => {
  await page.getByRole('button', { name: 'Test range calendar' }).click();
  await expect(popup(page)).toContainText('октябрь 2026');
  await expect(popup(page)).toHaveCSS('border-radius', '12px');
  await expect(popup(page)).toHaveCSS('font-family', /IBM Plex Sans/);
  await popup(page).getByRole('button', { name: '2026-10-20', exact: true }).click();
  await popup(page).getByRole('button', { name: '2026-10-10', exact: true }).click();
  await expect(page.getByLabel('Selected range')).toHaveText('2026-10-05|2026-10-07');
  await expect(popup(page).getByRole('button', { name: '2026-10-15', exact: true })).toHaveAttribute('data-in-range', 'true');
  await popup(page).getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(page.getByLabel('Selected range')).toHaveText('2026-10-10|2026-10-20');
  await expect(page.getByRole('button', { name: 'Test range calendar' })).toBeFocused();
  await page.getByRole('button', { name: 'Test range calendar' }).click();
  await popup(page).getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect(page.getByLabel('Selected range')).toHaveText('|');
});
test('month navigation, keyboard focus and Escape preserve an uncommitted selection', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Test range calendar' });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await expect(popup(page).getByRole('button', { name: '2026-10-05', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(popup(page).getByRole('button', { name: '2026-10-06', exact: true })).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(popup(page)).toContainText('сентябрь 2026');
  await expect(popup(page).getByRole('button', { name: '2026-09-06', exact: true })).toBeFocused();
  await page.keyboard.press('Space'); await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel('Selected range')).toHaveText('2026-10-05|2026-10-07');
  await trigger.click();
  await popup(page).getByRole('button', { name: 'Предыдущий месяц' }).click();
  await expect(popup(page).getByRole('button', { name: '2026-09-01', exact: true })).toHaveAttribute('title', /вторник/);
});
test('Accounting shares the calendar and preserves its automatic weekly period policy', async ({ page }) => {
  await page.locator('.accounting-date-filter .workspace-date-trigger').click();
  await expect(popup(page)).toHaveAttribute('data-mode', 'range');
  await expect(popup(page).getByRole('button', { name: 'Очистить', exact: true })).toHaveCount(0);
  await popup(page).getByRole('button', { name: '2026-10-15', exact: true }).click();
  await popup(page).getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(page.getByLabel('Accounting range')).toHaveText('2026-10-15|2026-10-21');
});
test('single-date fields use the same popup and retain required, real-date and min/max validation', async ({ page }) => {
  const input = page.getByLabel('Invoice date', { exact: true });
  await page.locator('[data-single-picker] .workspace-date-icon').click();
  await expect(popup(page)).toHaveAttribute('data-mode', 'single');
  await expect(popup(page).getByRole('button', { name: '2026-10-04', exact: true })).toBeDisabled();
  await expect(popup(page).getByRole('button', { name: '2026-10-21', exact: true })).toBeDisabled();
  await popup(page).getByRole('button', { name: '2026-10-20', exact: true }).click();
  await popup(page).getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(input).toHaveValue('2026-10-20');
  await page.getByRole('button', { name: 'Save test form' }).click();
  await expect(page.getByLabel('Saved date')).toHaveText('2026-10-20');
  for (const value of ['2026-10-03', '2026-02-31', '']) {
    await input.fill(value);
    expect(await input.evaluate(element => element.checkValidity())).toBe(false);
  }
  await input.fill('2026-10-10');
  expect(await input.evaluate(element => element.checkValidity())).toBe(true);
  await expect(page.getByLabel('Disabled date', { exact: true })).toBeDisabled();
});
for (const kind of ['custom', 'native']) test(`${kind} modal calendar escapes scroll clipping and owns only its first Escape`, async ({ page }) => {
  await page.getByRole('button', { name: `Open ${kind} modal` }).click();
  const modal = page.getByRole('dialog', { name: 'Test finance dialog', exact: true });
  await modal.locator('.workspace-date-icon').click();
  await expect(popup(page)).toBeVisible();
  const box = await popup(page).boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(10); expect(box.y).toBeGreaterThanOrEqual(10);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 10); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 10);
  await popup(page).getByRole('button', { name: '2026-10-10', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0); await expect(modal).toBeVisible();
  await expect(modal.getByLabel('Modal date', { exact: true })).toHaveValue('2026-10-08');
  await modal.locator('.workspace-date-icon').click();
  await popup(page).getByRole('button', { name: '2026-10-10', exact: true }).click();
  await popup(page).getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(modal.getByLabel('Modal date', { exact: true })).toHaveValue('2026-10-10');
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
});
test('calendar uses the workspace theme and translates labels consistently', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Toggle test theme' }).click();
  await page.getByRole('button', { name: 'Test range calendar' }).click();
  await expect(popup(page)).toHaveCSS('background-color', 'rgb(23, 34, 48)');
  await expect(popup(page).getByRole('button', { name: '2026-10-05', exact: true })).toHaveCSS('font-size', '14px');
  const audit = await new AxeBuilder({ page }).include('[data-workspace-calendar]').include('[data-single-picker]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.filter(issue => ['serious', 'critical'].includes(issue.impact))).toEqual([]);
  await page.screenshot({ path: `output/shared-calendar-${testInfo.project.name}.png` });
  await page.goto('/tests/ui/calendar.html?locale=en');
  await page.getByRole('button', { name: 'Test range calendar' }).click();
  await expect(popup(page)).toContainText('October 2026');
  await expect(popup(page).getByRole('button', { name: 'View', exact: true })).toBeVisible();
});
