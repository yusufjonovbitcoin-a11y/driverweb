import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';import { extractText } from 'unpdf';
test('edited PDF and server reference survive a full reload; access revocation prevents reopen',async({page})=>{
 await page.goto('/tests/ui/settlement-persistence.html');await page.getByRole('button',{name:'New statement'}).click();
 await page.getByRole('button',{name:'Edit PDF: Final Net',exact:true}).click();await page.getByLabel('Final Net',{exact:true}).fill('8000.25');
 await page.locator('.ds-pdf-inline-editor').getByRole('button',{name:'Apply to PDF',exact:true}).click();
 await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByLabel('Saved count')).toHaveText('1');
 await page.reload();await expect(page.getByText('#0001',{exact:true})).toBeVisible();await expect(page.getByLabel('Persisted Net')).toHaveText('800025');
 await page.getByRole('button',{name:'Open saved PDF'}).click();const link=page.getByRole('link',{name:'Download PDF'});await expect(link).toBeVisible();
 const promise=page.waitForEvent('download');await link.click();const download=await promise;const bytes=new Uint8Array(await readFile(await download.path()));
 expect((await extractText(bytes,{mergePages:true})).text).toContain('8,000.25');
 await page.reload();await page.getByRole('button',{name:'Revoke permission'}).click();await page.getByRole('button',{name:'Open saved PDF'}).click();await expect(page.getByText('Permission denied',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('a lost acknowledgement retries the original document and creates exactly one saved record',async({page})=>{
 await page.goto('/tests/ui/settlement-persistence.html?lostAck');await page.getByRole('button',{name:'New statement'}).click();
 await expect(page.getByRole('link',{name:'Download PDF'})).toBeVisible();await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect(page.getByLabel('Saved count')).toHaveText('1');await page.reload();await expect(page.getByLabel('Saved count')).toHaveText('1');
});
