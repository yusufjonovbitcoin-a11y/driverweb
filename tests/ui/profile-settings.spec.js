import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/tests/ui/profile-settings.html');
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveCount(0);
});

test('top tabs support manual keyboard activation and open section headings below sticky navigation', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Profile sections' });
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await page.getByRole('tab', { name: 'Team', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Personal details', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'profile-tab-overview');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.locator('.workspace-main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const personal = page.getByRole('tab', { name: 'Personal details', exact: true });
  await personal.click();
  await expect(personal).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await personal.getAttribute('id'));
  await expect.poll(async () => {
    const heading = await page.locator('.profile-section-heading').first().boundingBox();
    const navigation = await tabs.boundingBox();
    return heading.y >= navigation.y + navigation.height - 1;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('personal details form saves through the existing callback', async ({ page }) => {
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Personal details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Full name', { exact: true }).fill('Updated Admin');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Profile saves')).toHaveText('1');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Updated Admin');
});

test('regional controls keep working and integrations remain admin-only', async ({ page }) => {
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('uz');
  await expect(page.getByRole('tab', { name: 'Jamoa', exact: true })).toBeVisible();
  await page.locator('select[aria-label]').first().selectOption('en');
  await page.getByLabel('Time zone', { exact: true }).selectOption('America/Denver');
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/Denver');
  await page.getByLabel('Interface', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/tests/ui/profile-settings.html?role=dispatcher');
  await expect(page.getByRole('tab', { name: 'Integrations', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveCount(0);
});

test('notification switches are neutral when off and blue when enabled', async ({ page }) => {
  await page.getByRole('tab', { name: /^Notifications/ }).click();
  const calls = page.getByRole('switch', { name: 'Calls', exact: true });
  const messages = page.getByRole('switch', { name: 'Messages', exact: true });
  await expect(calls).toHaveAttribute('aria-checked', 'false');
  await expect(calls).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await calls.click();
  await page.mouse.move(0, 0);
  await expect(calls).toHaveAttribute('aria-checked', 'true');
  await expect(calls).toHaveCSS('background-color', 'rgb(36, 88, 211)');
  await expect(messages).toHaveAttribute('aria-checked', 'false');
  await calls.click();
  await page.mouse.move(0, 0);
  await expect(calls).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('missing push setup explains the disabled notification controls without a misleading network error', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?push=unconfigured');
  await page.getByRole('tab', { name: /^Notifications/ }).click();
  await expect(page.getByText('Browser notifications are not connected on this site yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('public VAPID key');
  await expect(page.getByRole('switch', { name: 'Calls', exact: true })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Messages', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test Calls notification', exact: true })).toBeDisabled();
  await expect(page.getByText('Changes are saved automatically.', { exact: true })).toHaveCount(0);
});

test('adding a user opens a contained modal, supports keyboard close, and creates through the existing callback', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add user', exact: true });
  await add.click();
  const modal = page.getByRole('dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  const box = await modal.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  const close = modal.getByRole('button', { name: 'Close new user form', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Create account', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await modal.getByLabel(/Full name/).fill('  New Driver  ');
  await modal.getByLabel(/Email/).fill('DRIVER@example.invalid');
  await modal.getByLabel(/Phone/).fill('+1 555 123 4567');
  await modal.getByLabel(/Initial password/).fill('Fixture-only-password');
  await modal.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByLabel('Created member')).toHaveText(JSON.stringify({ name: 'New Driver', email: 'driver@example.invalid', role: 'driver', gmailLabel: 'New Driver' }));
  await add.click();
  await expect(modal.getByLabel(/Initial password/)).toHaveValue('');
  await expect(modal.getByLabel(/Full name/)).toHaveValue('');
});

test('dispatcher creation starts with the selected role and keeps errors in the modal for retry', async ({ page }) => {
  await page.getByRole('button', { name: /^Dispatchers/ }).click();
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByLabel(/Role/)).toHaveValue('dispatcher');
  await modal.getByLabel(/Full name/).fill('Test Dispatcher');
  await modal.getByLabel(/Email/).fill('fail@example.invalid');
  await modal.getByLabel(/Phone/).fill('+1 555 987 6543');
  await modal.getByLabel(/Initial password/).fill('Fixture-only-password');
  await modal.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  await expect(modal.getByLabel(/Full name/)).toHaveValue('Test Dispatcher');
  await modal.getByLabel(/Email/).fill('dispatcher@example.invalid');
  await modal.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByLabel('Created member')).toHaveText(JSON.stringify({ name: 'Test Dispatcher', email: 'dispatcher@example.invalid', role: 'dispatcher', gmailLabel: null }));
});

test('Edit opens a full page and saves contact, pay and document settings together', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Edit driver: Test Driver', exact: true })).toBeVisible();
  const form = page.locator('.driver-settings-form');
  await expect(form.getByLabel('Full name', { exact: true })).toBeEnabled();
  await expect(form.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  await form.getByLabel('Full name', { exact: true }).fill('Updated Driver');
  await form.getByLabel('Phone', { exact: true }).fill('+1 555 777 8888');
  await form.getByRole('checkbox').check();
  await form.locator('input[type="number"]').fill('0.75');
  await form.getByRole('switch').uncheck();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByText('Changes saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to driver', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated Driver', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '+1 555 777 8888', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(form.locator('input[type="number"]')).toHaveValue('0.75');
  await expect(form.getByRole('switch')).not.toBeChecked();
});

test('edit page retains failed changes, confirms discard, and remains admin-only', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.locator('.driver-settings-form');
  await expect(form.getByLabel('Full name', { exact: true })).toBeEnabled();
  await form.getByLabel('Full name', { exact: true }).fill('Fail Save');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Full name', { exact: true })).toHaveValue('Fail Save');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to driver', exact: true }).click();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(form.getByLabel('Full name', { exact: true })).toHaveValue('Test Driver');
  await page.getByRole('button', { name: 'Back to driver', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/tests/ui/profile-settings.html?driver=1&role=dispatcher');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-driver-editor')).toHaveCount(0);
});

test('unsaved personal and driver drafts block tab changes, browser Back and reload', async ({ page }) => {
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Unsaved Admin');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Unsaved Admin');
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Unsaved Admin');
  await expect(page).toHaveURL(/section=overview/);
  const beforeUnload = page.waitForEvent('dialog');
  const reload = page.reload({ waitUntil: 'commit', timeout: 1500 }).catch(() => {});
  const dialog = await beforeUnload;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss(); await reload;
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Unsaved Admin');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Test Admin');
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const name = page.locator('.driver-settings-form').getByLabel('Full name', { exact: true });
  await expect(name).toBeEnabled(); await name.fill('Unsaved Driver');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await expect(name).toHaveValue('Unsaved Driver');
});

test('desktop routes restore the section, truck table, driver editor and browser history', async ({ page }) => {
  await page.getByRole('button', { name: 'Trucks', exact: true }).click();
  await expect(page).toHaveURL(/team=vehicles/);
  await expect(page.getByRole('table')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Trucks', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Trucks', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/tests/ui/profile-settings.html?driver=1#profile?edit=fixture-driver');
  await expect(page.getByRole('heading', { name: 'Edit driver: Test Driver' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit driver: Test Driver' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Company', exact: true })).toHaveCount(0);
});

test('cancelled loads do not mark a driver busy, suspended drivers stay manageable', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1#profile');
  await page.getByRole('button', { name: 'Back to drivers', exact: true }).click();
  const filters = page.getByRole('group', { name: 'Driver status filter' });
  await expect(filters.getByRole('button', { name: /Off duty/ })).toHaveCount(0);
  await expect(filters.getByRole('button', { name: /On load/ })).toHaveText(/0/);
  await filters.getByRole('button', { name: /Suspended/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'Paused Driver' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /privacy/i })).toHaveCount(0);
  await filters.getByRole('button', { name: /All/ }).click();
  await page.getByRole('button', { name: 'Edit Test Driver' }).click();
  const account = page.locator('.driver-settings-account-action');
  await account.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await account.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await expect(page.locator('.driver-settings-status')).toHaveText('Suspended');
  await expect(page.getByRole('heading', { name: 'Edit driver: Test Driver' })).toBeVisible();
});

test('password form validates, handles server reauthentication and clears secrets after success', async ({ page }) => {
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  const form = page.locator('.profile-password-form');
  await form.getByLabel('Current password', { exact: true }).fill('Fixture-old-password');
  await form.getByLabel('New password', { exact: true }).fill('Fixture-new-password');
  await form.getByLabel('Confirm new password', { exact: true }).fill('different-password');
  await form.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('The new passwords do not match.');
  await form.getByLabel('Confirm new password', { exact: true }).fill('Fixture-new-password');
  await page.evaluate(() => window.__profileAuth.failures.push('reauthentication_needed'));
  await form.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(form.getByLabel('Verification code', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Verification code sent to your account email or phone.');
  await form.getByLabel('Verification code', { exact: true }).fill('123456');
  await form.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(form.getByText('Password changed successfully.')).toBeVisible();
  await expect(form.getByLabel('Current password', { exact: true })).toHaveValue('');
  await expect(form.getByLabel('New password', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__profileAuth.updates.at(-1).nonce)).toBe('123456');
});

test('two-factor removal requires confirmation before calling the auth service', async ({ page }) => {
  await page.evaluate(() => { window.__profileAuth = { updates: [], failures: [], codes: 0, removals: 0, verified: true }; });
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  const remove = page.locator('.mfa-panel').getByRole('button', { name: /Remove/ });
  await expect(remove).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  expect(await page.evaluate(() => window.__profileAuth.removals)).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect.poll(() => page.evaluate(() => window.__profileAuth.removals)).toBe(1);
});

test('driver password is saved for later viewing, remains masked, and is retrieved explicitly after reopening', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Driver password', exact: true });
  const password = dialog.getByLabel('New password', { exact: true });
  const confirmation = dialog.getByLabel('Confirm new password', { exact: true });
  await expect(password).toHaveValue(''); await expect(password).toHaveAttribute('type', 'password');
  await expect(dialog.getByText(/No saved password is available/)).toBeVisible();
  await password.fill('Fixture-only-new-password');
  await dialog.getByRole('button', { name: 'Show password', exact: true }).first().click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('Fixture-only-new-password');
  await confirmation.fill('Different-fixture-password');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The new passwords do not match.');
  await confirmation.fill('Fixture-only-new-password');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('New password set.');
  const savedPassword = dialog.getByLabel('Password for sign-in', { exact: true });
  await expect(savedPassword).toHaveValue('Fixture-only-new-password');
  await expect(savedPassword).toHaveAttribute('type', 'password');
  await expect(savedPassword).toHaveAttribute('readonly', '');
  await expect(dialog.getByText(/view it here again after reopening/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Show saved password', exact: true }).click();
  await expect(savedPassword).toHaveAttribute('type', 'text');
  await expect(savedPassword).toHaveValue('Fixture-only-new-password');
  await dialog.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(savedPassword).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => window.__fixturePasswordUpdates)).toBe(1);
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('Fixture-only-new-password')))).toBe(false);
  const { violations } = await new AxeBuilder({ page }).include('.driver-password-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map(issue => issue.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(savedPassword).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  await expect(password).toHaveValue('');
  await expect(dialog.getByLabel('Confirm new password', { exact: true })).toHaveValue('');
  await expect(savedPassword).toHaveValue('');
  expect(await page.evaluate(() => window.__fixturePasswordReads || 0)).toBe(0);
  await dialog.getByRole('button', { name: 'Show saved password', exact: true }).click();
  await expect(savedPassword).toHaveValue('Fixture-only-new-password');
  expect(await page.evaluate(() => window.__fixturePasswordReads)).toBe(1);
});

test('driver password needs at least six characters when creating and updating a driver', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const password = dialog.getByLabel('New password', { exact: true });
  const confirmation = dialog.getByLabel('Confirm new password', { exact: true });
  await expect(password).toHaveAttribute('minlength', '6');
  await expect(confirmation).toHaveAttribute('minlength', '6');
  await password.fill('abcde'); await confirmation.fill('abcde');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  expect(await page.evaluate(() => window.__fixturePasswordUpdates || 0)).toBe(0);
  await expect(password).toBeFocused();
  await password.fill('abcdef'); await confirmation.fill('abcdef');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('New password set.');
  expect(await page.evaluate(() => window.__fixturePasswordUpdates)).toBe(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Back to drivers', exact: true }).click();
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  const initialPassword = page.getByRole('dialog').locator('input[name="password"]');
  await expect(initialPassword).toHaveAttribute('minlength', '6');
  await page.getByRole('dialog').getByLabel(/Role/).selectOption('dispatcher');
  await expect(initialPassword).toHaveAttribute('minlength', '12');
});

test('driver saved password survives page reopening without automatic plaintext retrieval or browser storage', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1&credential=available');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload();
    await page.getByRole('button', { name: 'Driver password', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const stored = dialog.getByLabel('Password for sign-in', { exact: true });
    await expect(stored).toHaveValue('');
    expect(await page.evaluate(() => window.__fixturePasswordReads || 0)).toBe(0);
    await dialog.getByRole('button', { name: 'Show saved password', exact: true }).click();
    await expect(stored).toHaveValue('Fixture-stored-password');
    await expect(stored).toHaveAttribute('type', 'text');
    expect(await page.evaluate(() => window.__fixturePasswordReads)).toBe(1);
    await dialog.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(stored).toHaveValue('');
    await expect(stored).toHaveAttribute('type', 'password');
    expect(await page.evaluate(() => [...Object.values(localStorage),...Object.values(sessionStorage)].some(value => value.includes('Fixture-stored-password')))).toBe(false);
  }
});

test('driver password reports a successful reset separately if encrypted retention fails', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New password', { exact: true }).fill('Fixture-unretained-password');
  await dialog.getByLabel('Confirm new password', { exact: true }).fill('Fixture-unretained-password');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('New password set.');
  await expect(dialog.getByText(/could not be saved for later viewing/)).toBeVisible();
  expect(await page.evaluate(() => window.__fixturePasswordUpdates)).toBe(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  await expect(dialog.getByText(/No saved password is available/)).toBeVisible();
});

test('driver password read failures do not expose a value and offer retry', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1&credential=error');
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Could not load the saved password.');
  await expect(dialog.getByLabel('Password for sign-in', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
});

test('driver password errors keep drafts masked and cancel protects edits; dispatcher has no reset action', async ({ page }) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Driver password', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New password', { exact: true }).fill('Fixture-failing-password');
  await dialog.getByLabel('Confirm new password', { exact: true }).fill('Fixture-failing-password');
  await dialog.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not set the new password');
  await expect(dialog.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'password');
  page.once('dialog', alert => alert.dismiss());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('.driver-password-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map(issue => issue.id)).toEqual([]);
  page.once('dialog', alert => alert.accept());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/tests/ui/profile-settings.html?driver=1&role=dispatcher');
  await expect(page.getByRole('button', { name: 'Driver password', exact: true })).toHaveCount(0);
});

test('PC pages preserve readable contrast, keyboard semantics and layout at laptop and desktop widths', async ({ page }, testInfo) => {
  await page.goto('/tests/ui/profile-settings.html?driver=1');
  await page.getByRole('button', { name: 'Back to drivers', exact: true }).click();
  for (const width of [1024, 1321, 1600, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
      await page.getByLabel('Interface', { exact: true }).selectOption(theme);
      for (const name of ['Team', 'Personal details', 'Integrations', 'Security', /^Notifications/]) {
        await page.getByRole('tab', { name, exact: typeof name === 'string' }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const { violations } = await new AxeBuilder({ page }).include('.profile-center').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(violations.map(issue => ({ rule: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([]);
      }
    }
  }
  await page.getByRole('tab', { name: 'Personal details', exact: true }).click();
  await page.getByLabel('Interface', { exact: true }).selectOption('light');
  await page.screenshot({ path: `output/profile-pc-${testInfo.project.name}.png`, fullPage: true });
});
