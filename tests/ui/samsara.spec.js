import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('company admin sees scoped telemetry and zero HOS, with accessible mobile layout', async({page})=>{
  await page.goto('/tests/ui/samsara.html');
  await expect(page.getByRole('heading',{name:'Samsara'})).toBeVisible();
  await expect(page.getByRole('link',{name:'New York, NY'})).toHaveAttribute('href',/query=40.7,-74/);
  await page.getByRole('button',{name:'Drivers · 1'}).click();
  await expect(page.getByRole('cell',{name:'0:00',exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'1:00',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const axe=await new AxeBuilder({page}).include('.samsara-panel').analyze();
  expect(axe.violations).toEqual([]);
});
test('missing HOS scope leaves vehicles available and shows an actionable explanation',async({page})=>{
  await page.goto('/tests/ui/samsara.html?state=partial&dark=1');
  await expect(page.getByText('Permission or Samsara license required',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'New York, NY'})).toBeVisible();
  await page.getByRole('button',{name:'Sync now'}).click();
  await expect(page.getByRole('button',{name:'Syncing…'})).toBeDisabled();
  expect(await page.evaluate(()=>window.samsaraActions.filter(a=>a==='sync').length)).toBe(1);
});
test('connect navigates to the server-issued provider URL and disconnect clears the snapshot',async({page})=>{
  await page.goto('/tests/ui/samsara.html?state=disconnected');
  await page.route('https://api.samsara.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Mock Samsara consent</h1>'}));
  await page.getByRole('button',{name:'Connect Samsara',exact:true}).click();
  await expect(page).toHaveURL(/https:\/\/api.samsara.com\/oauth2\/authorize/);
  await page.goto('/tests/ui/samsara.html');
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(page.getByRole('button',{name:'Connect Samsara',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'New York, NY'})).toHaveCount(0);
});
test('status failure can retry and non-admins never fetch or display the integration',async({page})=>{
  await page.goto('/tests/ui/samsara.html?state=error');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('link',{name:'New York, NY'})).toBeVisible();
  await page.goto('/tests/ui/samsara.html?role=driver');
  await expect(page.getByRole('heading',{name:'Samsara'})).toHaveCount(0);
  expect(await page.evaluate(()=>window.samsaraActions)).toEqual([]);
});
