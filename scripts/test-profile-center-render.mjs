import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } }, server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: Profile } = await server.ssrLoadModule('/src/components/ProfileView.jsx');
  const { ProfilePersonalPanel, ProfileSecurityPanel, ProfileNotificationsPanel } = await server.ssrLoadModule('/src/components/ProfileAccountPanels.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const props = { locale, timeZone: 'America/Chicago', theme: 'light', currentUser: { name: 'Test User', company: 'Test Company' }, onSection() {} };
    const page = renderToString(React.createElement(Profile, { ...props, loads: [], drivers: [] }));
    assert.ok(page.includes('profile-center-layout'));
    assert.ok(!page.includes('profile-identity-card'), 'settings use full-width content instead of a second sidebar');
    assert.ok(!page.includes('profile-logistics-banner'));
    assert.ok(!page.includes('profile-center-heading'), 'visible settings/account header removed');
    assert.ok(page.includes(`<h1 class="profile-settings-title">${i18n.t('profile.settingsTitle')}</h1>`), 'settings title remains visible above the top tabs');
    assert.ok(page.includes('role="tablist"'));
    assert.ok(!page.includes('id="profile-tab-settings"'));
    assert.ok(page.includes('role="tabpanel" aria-labelledby="profile-tab-company"'));
    assert.ok(page.includes('profile-company-panel'));
    assert.ok(!page.includes('id="profile-tab-integrations"'), 'integration tab remains admin-only');
    assert.ok(!page.includes('profile-center-search'), 'removed settings search');
    const legacySection = renderToString(React.createElement(Profile, { ...props, loads: [], drivers: [], initialSection: 'settings' }));
    assert.ok(legacySection.includes('role="tabpanel" aria-labelledby="profile-tab-company"'), 'legacy General entry opens Team');

    const accountProps = { ...props, currentUser: { name: '<Admin>', email: 'admin@example.com', phone: '+1 555 123 4567', roleCode: 'company_admin', company: 'Test Company' } };
    const personal = renderToString(React.createElement(ProfilePersonalPanel, accountProps));
    assert.ok(personal.includes('&lt;Admin&gt;'), 'profile values escaped');
    assert.ok(personal.includes('admin@example.com'));
    assert.ok(personal.includes('value="America/Chicago" selected=""'));
    assert.equal((personal.match(/<select/g) || []).length, 3);
    assert.ok(personal.includes(i18n.t('profile.editLockedHint')));
    assert.match(personal, /<input(?=[^>]*name="email")(?=[^>]*readOnly="")[^>]*>/);
    assert.match(personal, /<input(?=[^>]*name="role")(?=[^>]*readOnly="")[^>]*>/);
    assert.match(personal.replaceAll('<!-- -->', ''), /New York — ET · \d{2}:\d{2}/);
    const adminForm = renderToString(React.createElement(ProfilePersonalPanel, { ...accountProps, currentUser: { ...accountProps.currentUser, companyId: 'company-a' } }));
    assert.ok(!/<input(?=[^>]*name="company")(?=[^>]*readOnly)[^>]*>/.test(adminForm));
    const staffForm = renderToString(React.createElement(ProfilePersonalPanel, { ...accountProps, currentUser: { ...accountProps.currentUser, roleCode: 'dispatcher' } }));
    assert.ok(!staffForm.includes('name="company"'), 'company-wide settings are not in the personal form');
    const security = renderToString(React.createElement(ProfileSecurityPanel, accountProps));
    assert.ok(security.includes(i18n.t('profile.changePassword')));
    assert.ok(!security.includes(i18n.t('profile.secureActive')), 'do not assert unsupported security status');
    assert.ok(security.includes('autoComplete="current-password"') && security.includes('autoComplete="new-password"'), 'password manager aware change form');
    const notifications = renderToString(React.createElement(ProfileNotificationsPanel, { unreadChatCount: 3, unreadInboxCount: 2 }));
    assert.ok(notifications.includes(i18n.t('profile.newNotifications', { count: 5 })));
    assert.equal((notifications.match(/class="profile-notification-row"/g) || []).length, 2);
    const pushSwitches = [...notifications.matchAll(/<button(?=[^>]*role="switch")[^>]*>/g)];
    assert.equal(pushSwitches.length, 2, 'existing browser push category controls remain present');
    assert.ok(pushSwitches.every(([button]) => button.includes('disabled=""')), 'push controls stay disabled when browserPush is unavailable');
    for (const html of [personal, security, notifications]) assert.ok(!/profile\.[a-zA-Z]+/.test(html), 'no untranslated profile keys');
    const company = renderToString(React.createElement(Profile, { ...accountProps, loads: [], drivers: [], initialDriverToEditId: 'not-loaded' }));
    assert.ok(company.includes('profile-company-panel'));
    assert.ok(company.includes('profile-company-tabs'));
    assert.ok(company.includes(i18n.t('drivers.noDrivers')));
    const explicitDriver = renderToString(React.createElement(Profile, { ...accountProps,
      initialSection: 'company', selectedDriverId: 'driver-a', loads: [],
      drivers: [{ id:'driver-a', name:'Requested Driver', driverNumber:'#FIXTURE' }],
    }));
    assert.ok(explicitDriver.includes('Requested Driver') && explicitDriver.includes('id="driver-profile-title"'), 'explicit navigation opens the requested driver');
    const driverBack = renderToString(React.createElement(Profile, { ...accountProps, initialSection:'company', loads:[], drivers:[] }));
    assert.ok(driverBack.includes('profile-company-panel'), 'explicit back request returns to the driver list instead of Settings');

  }
  console.log('Profile center: 3 locales, Team entry, role gating, account panels, regional/theme controls, unread counts, safe data display and company layout passed.');
} finally { await server.close(); }
