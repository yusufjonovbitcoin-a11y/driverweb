import {test,expect} from '@playwright/test';
test('enforced production CSP allows PDF worker rendering and blocks inline scripts',async({page})=>{
 const failures=[];page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')failures.push(message.text());});page.on('pageerror',error=>failures.push(error.message));
 const response=await page.goto('/tests/ui/security.html');expect(response.headers()['content-security-policy']).toContain("script-src-attr 'none'");
 await page.getByRole('button',{name:'Open protected PDF'}).click();try{await expect(page.locator('.textLayer')).toContainText('Protected PDF content');}catch(error){throw Error(JSON.stringify(failures)+'\n'+error.message);}
 await page.addScriptTag({content:'window.inlineWasExecuted=true'}).catch(()=>{});expect(await page.evaluate(()=>window.inlineWasExecuted)).toBeUndefined();
});
test('authenticator setup verifies a code before enabling and supports cancellation and removal',async({page})=>{
 await page.goto('/tests/ui/security.html');await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await expect(page.getByRole('img',{name:'Authenticator setup QR code'})).toBeVisible();
 await page.getByLabel('Six-digit code').fill('000000');await page.getByRole('button',{name:'Verify',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByLabel('Six-digit code').fill('123456');await page.getByRole('button',{name:'Verify',exact:true}).click();await expect(page.getByText('Two-step verification is enabled.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remove authenticator',exact:true}).click();await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await page.getByRole('button',{name:'Cancel setup'}).click();await expect(page.getByRole('img')).toHaveCount(0);
});
