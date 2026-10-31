const usd = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'USD'}).format(value);
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const nav = page => page.getByRole('navigation', { name: 'Разделы финансового центра' });
test('analytics language and financial formatting update in place in all supported locales',async({page})=>{
 await page.goto('/tests/ui/financial-center.html?locales');
 for(const [locale,title] of [['en','Financial center'],['uz','Moliya markazi'],['ru','Финансовый центр']]){
  await page.getByRole('button',{name:'Language '+locale}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  // Chromium and Node may ship different CLDR versions for Uzbek formatting.
  const expected=await page.evaluate(code=>new Intl.NumberFormat(code==='uz'?'uz-UZ':code==='en'?'en-US':'ru-RU',{style:'currency',currency:'USD'}).format(3500),locale);
  await expect(page.locator('.fc-summary')).toContainText(expected);
  await expect(page.locator('.fc-main')).not.toContainText('financialCenter.');
 }
});
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/financial-center.html');
  await expect(page.locator('.fc-summary')).toContainText(usd(3500));
});

test('company analytics replaces demo and ignores old browser demo records', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('t-fleets.analytics-demo.v1', JSON.stringify({ gross: 999999999 })));
  await page.reload();
  await expect(page.locator('.fc-summary')).toContainText(usd(3500));
  await expect(page.locator('.fc-summary')).toContainText(usd(2947.5));
  await expect(page.getByText(/ДЕМО|DEMO|Реальные рейсы/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Добавить демо|Восстановить демо/ })).toHaveCount(0);
  await expect(page.locator('.fc-live-tag')).toHaveText('Данные компании');
  await expect(page.locator('.fc-incomplete')).toContainText('расходы компании — 1');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toHaveCount(0);
  await expect(page.locator('.fc-data-basis')).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: /Настройки расчёта|Обновить/ })).toHaveCount(0);
});

test('all finance views, filters, date selection and CSV share the same real rows', async ({ page }) => {
  for (const name of ['Грузы', 'Водители', 'Компания', 'Комиссии']) {
    await nav(page).getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.fc-main table').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await nav(page).getByRole('button', { name: 'Грузы', exact: true }).click();
  await page.getByRole('searchbox').fill('LOAD-A');
  await expect(page.locator('.fc-summary')).toContainText(usd(1000));
  await expect(page.locator('.fc-summary')).toContainText(usd(800));
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV груза', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).not.toContain('DEMO');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('"LOAD-A","Test Driver Alpha"');
  expect(csv).not.toContain('LOAD-B');
  expect(csv).toContain('"1000.00","100.00","5.00","0.00","800.00","60.00","40.00","95.00"');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^CSV выгружен:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Очистить фильтры' }).click();
  await page.getByLabel('Рейсы', { exact: true }).selectOption('active');
  await expect(page.locator('.fc-summary')).toContainText(usd(400));
  await expect(page.locator('.fc-load-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Рейсы', { exact: true }).selectOption('completed');
  await page.locator('.fc-date .workspace-date-trigger').click();
  await page.locator('[data-workspace-calendar]').getByRole('button', { name: '2026-10-09', exact: true }).click();
  await page.locator('[data-workspace-calendar]').getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(page.locator('.fc-summary')).toContainText(usd(500));
  await expect(page.locator('.fc-summary')).toContainText(usd(447.5));
});

test('summary, allocation, driver reports and chart days open matching details', async ({ page }) => {
  await page.locator('.fc-summary button').first().click();
  await expect(page.getByRole('heading', { name: 'Финансовый реестр грузов' })).toBeVisible();
  await page.getByLabel('Порядок грузов').selectOption('gross-desc');
  await expect(page.locator('.fc-load-table tbody tr').first()).toContainText('LOAD-B');
  await nav(page).getByRole('button', { name: 'Обзор', exact: true }).click();
  const companyFlow = page.locator('[data-flow-key="company"]');
  // Narrow screens use the labelled cards instead of squeezing the ribbon chart.
  const companyControl = await companyFlow.isVisible() ? companyFlow : page.locator('[data-allocation-key="company"]');
  await companyControl.focus();
  await expect(page.getByRole('tooltip')).toContainText(usd(350));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Финансы компании' })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.locator('.fc-driver-panel').getByRole('button', { name: 'Test Driver Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Все рейсы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Доходы водителей' })).toBeVisible();
  await expect(page.locator('.fc-driver-detail tbody tr')).toHaveCount(2);
  await expect(page.locator('.fc-driver-panel')).not.toContainText('Test Driver Beta');
  await nav(page).getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.locator('.fc-trend [role=button]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Финансовый реестр грузов' })).toBeVisible();
  await expect(page.locator('.fc-load-table tbody tr')).toHaveCount(1);
});

test('load accounting saves through the versioned API and updates every financial amount', async ({ page }) => {
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Сохранённая оплата рейса');
  await dialog.getByRole('button', { name: 'Учёт расходов' }).click();
  await dialog.getByLabel('Учтённая оплата водителю · USD').fill('750');
  await dialog.getByLabel('Топливо компании · USD').fill('60');
  await dialog.getByLabel('Другие расходы компании · USD').fill('5');
  await dialog.getByRole('button', { name: 'Сохранить учёт' }).click();
  await expect(page.getByLabel('Fixture action')).toHaveText('saved:load-a');
  await expect(dialog).toContainText('Введено в учёте');
  await expect(dialog).toContainText(usd(750));
  await page.keyboard.press('Escape');
  await expect(page.locator('.fc-summary')).toContainText(usd(750));
  await expect(page.locator('.fc-company-result')).toContainText(usd(25));
});

test('existing load and accounting settings actions use app callbacks', async ({ page }) => {
  await nav(page).getByRole('button', { name: 'Комиссии', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки расчёта', exact: true }).click();
  await expect(page.getByLabel('Fixture action')).toHaveText('accounting-settings');
  await nav(page).getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  await page.getByRole('button', { name: 'Документы груза', exact: true }).click();
  await expect(page.getByLabel('Fixture action')).toHaveText('load:load-a');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('unknown and empty data stay explicit, without invented profits or records', async ({ page }) => {
  await page.goto('/tests/ui/financial-center.html?case=unknown');
  await expect(page.locator('.fc-summary button').nth(1).locator('strong')).toHaveText('—');
  await expect(page.locator('.fc-summary button').nth(3).locator('strong')).toHaveText('—');
  await expect(page.locator('.fc-flow-missing')).toBeVisible();
  await expect(page.locator('.fc-company-result .fc-result dd')).toContainText('—');
  await page.goto('/tests/ui/financial-center.html?case=empty');
  await expect(page.locator('.fc-summary')).toContainText(usd(0));
  await expect(page.locator('.fc-driver-panel tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toHaveCount(0);
});

test('permission errors hide financial data and network errors can be retried', async ({ page }) => {
  await page.goto('/tests/ui/financial-center.html?case=permission');
  await expect(page.getByRole('alert')).toContainText('Нет доступа');
  await expect(page.locator('.fc-summary')).toHaveCount(0);
  await page.goto('/tests/ui/financial-center.html?case=error');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');
  await page.getByRole('button', { name: 'Restore test network' }).click();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.fc-summary')).toContainText(usd(3500));
});

test('stale data is labelled and cannot be exported or edited after a failed automatic refresh', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-24T12:00:00Z') });
  await page.goto('/tests/ui/financial-center.html?case=stale');
  await expect(page.locator('.fc-summary')).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByRole('alert')).toContainText('предыдущие данные');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  await expect(page.getByRole('button', { name: 'Учёт расходов' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'CSV груза' })).toBeDisabled();
});

test('conflicting accounting edits preserve drafts and do not change displayed totals', async ({ page }) => {
  await page.goto('/tests/ui/financial-center.html?case=conflict');
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Учёт расходов' }).click();
  await dialog.getByLabel('Учтённая оплата водителю · USD').fill('900');
  await dialog.getByRole('button', { name: 'Сохранить учёт' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Запись уже изменена');
  await expect(dialog.getByLabel('Учтённая оплата водителю · USD')).toHaveValue('900');
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog).toContainText(usd(800));
});

test('automatic refresh cannot attach a new revision to an old unsaved draft', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-24T12:00:00Z')});
  await page.goto('/tests/ui/financial-center.html?case=concurrent');
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button',{name:'Открыть расчёт груза LOAD-A'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Учёт расходов'}).click();
  await dialog.getByLabel('Учтённая оплата водителю · USD').fill('777');
  await page.clock.runFor(61_000);
  await expect(dialog.getByRole('alert')).toContainText('Другой пользователь');
  await expect(dialog.getByLabel('Учтённая оплата водителю · USD')).toHaveValue('777');
  await expect(dialog.getByRole('button',{name:'Сохранить учёт'})).toBeDisabled();
  await expect(page.getByLabel('Fixture action')).toHaveText('');
  page.once('dialog',prompt=>prompt.accept());
  await dialog.getByRole('button',{name:'Загрузить актуальные значения'}).click();
  await expect(dialog.getByLabel('Учтённая оплата водителю · USD')).toHaveValue('900');
  await dialog.getByLabel('Учтённая оплата водителю · USD').fill('901');
  await dialog.getByRole('button',{name:'Сохранить учёт'}).click();
  await expect(page.getByLabel('Fixture action')).toHaveText('saved:load-a');
  await expect(dialog).toContainText(usd(901));
});

test('Escape and close preserve dirty accounting until discard is explicitly accepted',async({page})=>{
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button',{name:'Открыть расчёт груза LOAD-A'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Учёт расходов'}).click();
  await dialog.getByLabel('Топливо компании · USD').fill('777');
  page.once('dialog',prompt=>prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog.getByLabel('Топливо компании · USD')).toHaveValue('777');
  page.once('dialog',prompt=>prompt.accept());
  await dialog.getByRole('button',{name:'Закрыть расчёт'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Fixture action')).toHaveText('');
});

test('approved PDF Net is the same in company and driver analytics with read-only approved pay',async({page})=>{
  await page.goto('/tests/ui/financial-center.html?case=approved&scope=alpha');
  await expect(page.locator('.df-summary')).toContainText(usd(2200.01));
  await page.getByRole('button',{name:'Company analytics',exact:true}).click();
  await expect(page.locator('.fc-summary')).toContainText(usd(2647.51));
  await page.getByRole('searchbox').fill('LOAD-A');
  await nav(page).getByRole('button',{name:'Компания',exact:true}).click();
  const cash=page.locator('.fc-cash-flow');
  await expect(cash).toContainText(usd(100));
  await expect(cash).toContainText(usd(1100));
  await expect(cash).toContainText(usd(950));
  await expect(cash).toContainText(usd(150));
  await nav(page).getByRole('button',{name:'Грузы',exact:true}).click();
  await page.getByRole('button',{name:'Открыть расчёт груза LOAD-A'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Подтверждённый расчёт');
  await dialog.getByRole('button',{name:'Учёт расходов'}).click();
  await expect(dialog.getByLabel('Учтённая оплата водителю · USD')).toBeDisabled();
});

test('changing the account timezone immediately regroups the displayed trip date',async({page})=>{
  await page.goto('/tests/ui/financial-center.html?case=boundary');
  await page.getByRole('searchbox').fill('LOAD-A');
  await nav(page).getByRole('button',{name:'Грузы',exact:true}).click();
  await expect(page.locator('.fc-load-table tbody')).toContainText('2 окт.');
  await page.getByRole('button',{name:'America/Los_Angeles',exact:true}).click();
  await expect(page.locator('.fc-load-table tbody')).toContainText('1 окт.');
  await page.getByRole('button',{name:'America/New_York',exact:true}).click();
  await expect(page.locator('.fc-load-table tbody')).toContainText('2 окт.');
});

test('light/dark styles, readable typography and dialogs remain consistent', async ({ page }, testInfo) => {
  await expect(page.locator('.financial-center')).toHaveCSS('font-family', /IBM Plex Sans/);
  await expect(page.locator('.fc-heading h1')).toHaveCSS('font-size', '28px');
  await expect(page.locator('.fc-driver-table tbody td').first()).toHaveCSS('font-size', '14px');
  await expect(page.locator('.fc-driver-table thead th').first()).toHaveCSS('font-size', '12px');
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
  await expect(page.locator('.financial-center')).toHaveCSS('color-scheme', 'dark');
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(19, 37, 52)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Светлая тема', exact: true }).click();
  await expect(page.locator('.financial-center')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('searchbox').fill('');
  await page.locator('.fc-main').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `output/financial-live-${testInfo.project.name}.png`, fullPage: true });
});

test('a driver has a simple single-page report with scoped totals, loads, date filters and details', async ({ page }) => {
  await page.goto('/tests/ui/financial-center.html?scope=alpha');
  const center = page.getByRole('region', { name: 'Аналитика водителя: Test Driver Alpha', exact: true });
  await expect(center.getByRole('heading', { name: 'Доходы и рейсы', exact: true })).toBeVisible();
  await expect(center.getByRole('navigation')).toHaveCount(0);
  await expect(center.locator('.fc-allocation')).toHaveCount(0);
  await expect(center.locator('.df-summary')).toContainText(usd(3000));
  await expect(center.locator('.df-summary')).toContainText(usd(315));
  await expect(center.locator('.df-summary')).toContainText(usd(2500));
  await expect(center.getByRole('combobox', { name: 'Рейсы' }).locator('option')).toHaveText(['Завершённые (2)', 'Активные (0)', 'Запланированные (0)', 'Все, кроме отменённых (2)']);
  await expect(center).not.toContainText('Test Driver Beta');
  await expect(center.getByRole('button', { name: /Открыть расчёт груза/ })).toHaveCount(2);
  await center.getByRole('searchbox').fill('LOAD-C');
  await expect(center.locator('.df-summary')).toContainText(usd(0));
  await center.getByRole('button', { name: 'Очистить фильтры' }).click();
  await center.getByRole('button', { name: 'Все даты', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '2026-10-01', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Вид', exact: true }).click();
  await expect(center.locator('.df-summary')).toContainText(usd(1000));
  await center.getByRole('button', { name: 'Очистить фильтры' }).click();
  await center.getByRole('button', { name: 'Открыть расчёт груза LOAD-A' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Test Driver Alpha');
  await expect(dialog.getByRole('button', { name: 'Показать водителя' })).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'CSV груза' }).click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  expect(csv).toContain('LOAD-A');
  expect(csv).not.toMatch(/LOAD-C|LOAD-D|Test Driver Beta/);
  await page.keyboard.press('Escape');
  await center.getByRole('combobox', { name: 'Рейсы' }).selectOption('active');
  await expect(center.locator('.df-summary')).toContainText(usd(0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('driver reports reset on driver change and do not affect the company report', async ({ page }) => {
  await page.goto('/tests/ui/financial-center.html?scope=alpha');
  await page.getByRole('searchbox').fill('LOAD-A');
  await page.getByRole('button', { name: 'Open beta', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('.df-summary')).toContainText(usd(500));
  await expect(page.locator('.df-main')).not.toContainText('Test Driver Alpha');
  await page.getByRole('combobox', { name: 'Рейсы' }).selectOption('active');
  await expect(page.locator('.df-summary')).toContainText(usd(400));
  await expect(page.getByRole('button', { name: 'Открыть расчёт груза LOAD-D' })).toBeVisible();
  await page.getByRole('button', { name: 'Company analytics', exact: true }).click();
  await expect(page.locator('.fc-summary')).toContainText(usd(3500));
  await expect(page.getByRole('heading', { name: 'Финансовый центр', exact: true })).toBeVisible();
});

test('empty driver reports do not fall back to company values and support both themes', async ({ page }, testInfo) => {
  await page.goto('/tests/ui/financial-center.html?scope=no-trips');
  await expect(page.locator('.df-summary')).toContainText(usd(0));
  await page.getByRole('combobox', { name: 'Рейсы' }).selectOption('all');
  await expect(page.locator('.df-main')).not.toContainText('Test Driver Alpha');
  await expect(page.locator('.df-main')).not.toContainText('Test Driver Beta');
  await expect(page.getByRole('button', { name: /Открыть расчёт груза/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
  await expect(page.locator('.driver-financial-report')).toHaveCSS('color-scheme', 'dark');
  await page.getByRole('button', { name: 'Open alpha', exact: true }).click();
  await expect(page.locator('.df-summary')).toContainText(usd(3000));
  await page.screenshot({ path: `output/driver-report-${testInfo.project.name}.png`, fullPage: true });
});
