import { test, expect } from '@playwright/test';
for (const [type, title] of [['bol', 'BOL'], ['pod', 'POD'], ['invoice', 'Invoice'], ['unknown', 'Rate Con']]) {
  test(`${type} shows its document type without load review or assignment controls`, async ({ page }) => {
    const network = [];
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') { network.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`/tests/ui/import-document-type.html?type=${type}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Тип документа:.*${title}`) })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Этот документ не анализируется как новый груз');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Назначить водителю', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'К грузам', exact: true }).click();
    expect(await page.evaluate(() => window.typeTestActions)).toEqual(['back']);
    expect(network).toEqual([]);
  });
}
