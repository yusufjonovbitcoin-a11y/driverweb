import {test,expect} from '@playwright/test';
const trigger=page=>page.getByRole('button',{name:'Завершить рейс',exact:true});
const confirm=page=>page.getByRole('button',{name:'Подтвердить и завершить',exact:true});
const dialog=page=>page.locator('dialog.staff-completion-dialog');
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
});
test('finish action appears beside tabs only after every BOL/POD is saved',async({page})=>{
  await page.goto('/tests/ui/staff-completion.html?mode=missing');
  await expect(trigger(page)).toHaveCount(0);
  await page.getByRole('tab',{name:'Документы',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить POD',exact:true}).click();
  await expect(trigger(page)).toBeVisible();
  expect(await page.getByRole('tablist').getByRole('button').count()).toBe(0);
  await trigger(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Действия водителя в приложении для этого не требуются');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(await page.evaluate(()=>window.completionRequests.length)).toBe(0);
});
test('web finishes an unstarted trip with saved evidence and delivery details',async({page})=>{
  await page.goto('/tests/ui/staff-completion.html');
  await trigger(page).click();
  await expect(dialog(page).getByLabel('Часовой пояс', { exact: true })).toHaveCount(0);
  await dialog(page).getByLabel('Комментарий (необязательно)').fill('Доставка подтверждена диспетчером');
  await confirm(page).click();
  await expect(page.getByRole('status')).toHaveText('Рейс завершён');
  await expect(trigger(page)).toHaveCount(0);
  const requests=await page.evaluate(()=>window.completionRequests);
  expect(requests).toHaveLength(1);expect(requests[0].versionIds).toEqual(['bol-version','pod-version']);
  expect(requests[0].assignmentId).toBe('assignment');expect(requests[0].deliveredLocal).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(requests[0].timeZone).toBe('America/New_York');
});
test('failed completion stays open and an unchanged retry reuses the operation ID',async({page})=>{
  await page.goto('/tests/ui/staff-completion.html?mode=retry');await trigger(page).click();await confirm(page).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();await expect(page.getByRole('status')).toHaveText('Рейс завершён');
  const requests=await page.evaluate(()=>window.completionRequests);expect(requests).toHaveLength(2);
  expect(requests[0].operationId).toBe(requests[1].operationId);
});
test('pending confirmation blocks duplicate submission and premature dismissal',async({page})=>{
  await page.goto('/tests/ui/staff-completion.html?mode=deferred');await trigger(page).click();await confirm(page).click();
  await expect(page.getByRole('button',{name:'Завершаем…',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(()=>window.completionRequests.length)).toBe(1);
  await page.evaluate(()=>window.finishCompletion());await expect(page.getByRole('status')).toHaveText('Рейс завершён');
});
test('read-only users have no completion control',async({page})=>{
  await page.goto('/tests/ui/staff-completion.html?mode=readonly');await expect(trigger(page)).toHaveCount(0);
});
