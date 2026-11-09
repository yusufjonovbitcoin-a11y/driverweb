import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openCamera(page, query = '') {
  await page.route('https://fixture.s3.amazonaws.com/camera.jpg', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#253c61"/></svg>'}));
  await page.goto(`/tests/ui/samsara.html${query}`);
  await page.getByRole('button',{name:'View',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Cameras · Truck 104'})).toBeFocused();
}
test('recordings load on demand, preserve pagination filters, and videos do not prefetch',async({page})=>{
  const videoRequests=[]; page.on('request',request=>{if(request.url().endsWith('.mp4')) videoRequests.push(request.url());});
  await openCamera(page);
  await page.getByRole('button',{name:'Show recordings',exact:true}).click();
  await expect(page.getByRole('img',{name:/Camera photo at/})).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(videoRequests).toEqual([]);
  const first=await page.evaluate(()=>window.cameraActions.find(a=>a.action==='list').payload);
  await page.getByRole('combobox',{name:'Camera',exact:true}).selectOption('dashcamDriverFacing');
  await page.getByRole('button',{name:'Load more',exact:true}).click();
  const second=await page.evaluate(()=>window.cameraActions.filter(a=>a.action==='list')[1].payload);
  expect(second).toEqual({...first,after:'page-2'});
  await page.getByRole('button',{name:'Open video player'}).click();
  await expect(page.locator('video')).toHaveAttribute('preload','none');
  await expect(page.locator('video')).toHaveAttribute('controls','');
  expect(videoRequests).toEqual([]);
  await page.getByRole('button',{name:'Close cameras'}).click();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'View',exact:true})).toBeFocused();
});
test('recording requests are explicit, show pending state and refresh without another POST',async({page},testInfo)=>{
  await openCamera(page,'?dark=1');
  expect(await page.evaluate(()=>window.cameraActions.some(a=>a.action==='create'))).toBe(false);
  await page.locator('summary').filter({hasText:'Request a photo or video'}).click();
  await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('videoHighRes');
  await page.getByRole('button',{name:'Request recording',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Waiting for recording');
  const create=await page.evaluate(()=>window.cameraActions.find(a=>a.action==='create'));
  expect(Date.parse(create.payload.endTime)-Date.parse(create.payload.startTime)).toBe(15000);
  await page.getByRole('button',{name:'Check again / refresh links'}).click();
  await expect(page.getByRole('status')).toContainText('Recording ready');
  expect(await page.evaluate(()=>window.cameraActions.filter(a=>a.action==='create').length)).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const axe=await new AxeBuilder({page}).include('.samsara-camera').analyze();
  expect(axe.violations).toEqual([]);
  await page.locator('.samsara-camera').screenshot({path:`output/samsara-camera-${testInfo.project.name}.png`});
});
test('missing camera scope shows precise instructions and active connections can reauthorize',async({page})=>{
  await openCamera(page,'?state=camera-permission');
  await page.getByRole('button',{name:'Show recordings',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Safety & Cameras → Read Media Retrieval');
  await page.route('https://api.samsara.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Mock Samsara consent</h1>'}));
  await page.getByRole('alert').getByRole('button',{name:'Update permissions'}).click();
  await expect(page).toHaveURL(/https:\/\/api.samsara.com\/oauth2\/authorize/);
});
