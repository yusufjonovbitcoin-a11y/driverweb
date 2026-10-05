import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } }, server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: Hub } = await server.ssrLoadModule('/src/components/ProfileSettingsHub.jsx');
  const { default: Profile } = await server.ssrLoadModule('/src/components/ProfileView.jsx');
  const { ProfilePersonalPanel, ProfileSecurityPanel, ProfileNotificationsPanel, ProfileContactPanel } = await server.ssrLoadModule('/src/components/ProfileAccountPanels.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const props = { locale, timeZone: 'America/Chicago', theme: 'light', currentUser: { name: 'Test User', company: 'Test Company' }, onSection() {} };
    const html = renderToString(React.createElement(Hub, props));
    for (const key of ['settingsCenter', 'workspaceGroup', 'connectionsGroup', 'accountGroup', 'settingsSearch', 'noSettingsFound']) assert.notEqual(i18n.t(`profile.${key}`), `profile.${key}`);
    assert.equal((html.match(/class="profile-settings-group"/g) || []).length, 3);
    assert.ok(!html.includes('Gmail'), 'integration controls not exposed to non-admin');
    const filtered = renderToString(React.createElement(Hub, { ...props, query: 'gmail', canManageIntegrations: true }));
    assert.equal((filtered.match(/class="profile-setting-row"/g) || []).length, 1);
    assert.ok(filtered.includes('Gmail'));
    assert.ok(!filtered.includes('is-connected'), 'unknown connection is not reported connected');
    const connected = renderToString(React.createElement(Hub, { ...props, canManageIntegrations: true, gmailConnection: { status: 'active' } }));
    assert.ok(connected.includes('is-connected'));
    const empty = renderToString(React.createElement(Hub, { ...props, query: 'nonexistent-setting-xyz' }));
    assert.ok(empty.includes(i18n.t('profile.noSettingsFound')));
    const page = renderToString(React.createElement(Profile, { ...props, loads: [], drivers: [] }));
    assert.ok(page.includes('profile-center-layout'));
    assert.ok(page.includes('profile-identity-card'));
    assert.ok(!page.includes('profile-logistics-banner'));
    assert.ok(!page.includes('profile-center-heading'), 'removed settings header');
    assert.ok(!page.includes('profile-center-search'), 'removed settings search');
    const accountProps = { ...props, currentUser: { name: '<Admin>', email: 'admin@example.com', phone: '+1 555 123 4567', roleCode: 'company_admin', company: 'Test Company' } };
    const personal = renderToString(React.createElement(ProfilePersonalPanel, accountProps));
    assert.ok(personal.includes('&lt;Admin&gt;'), 'profile values escaped');
    assert.ok(personal.includes('admin@example.com'));
    assert.ok(personal.includes('value="America/Chicago" selected=""'));
    assert.equal((personal.match(/<select/g) || []).length, 2);
    assert.ok(personal.includes(i18n.t('profile.editLockedHint')));
    assert.match(personal, /<input(?=[^>]*name="email")(?=[^>]*readOnly="")[^>]*>/);
    assert.match(personal, /<input(?=[^>]*name="role")(?=[^>]*readOnly="")[^>]*>/);
    assert.match(personal.replaceAll('<!-- -->', ''), /New York — ET · \d{2}:\d{2}/);
    const adminForm = renderToString(React.createElement(ProfilePersonalPanel, { ...accountProps, currentUser: { ...accountProps.currentUser, companyId: 'company-a' } }));
    assert.ok(!/<input(?=[^>]*name="company")(?=[^>]*readOnly)[^>]*>/.test(adminForm));
    const staffForm = renderToString(React.createElement(ProfilePersonalPanel, { ...accountProps, currentUser: { ...accountProps.currentUser, roleCode: 'dispatcher' } }));
    assert.match(staffForm, /<input(?=[^>]*name="company")(?=[^>]*readOnly="")[^>]*>/);
    const security = renderToString(React.createElement(ProfileSecurityPanel, accountProps));
    assert.ok(security.includes(i18n.t('profile.passwordReadOnly')));
    assert.ok(!security.includes(i18n.t('profile.secureActive')), 'do not assert unsupported security status');
    assert.ok(!security.includes('<input'), 'no nonfunctional password form');
    const notifications = renderToString(React.createElement(ProfileNotificationsPanel, { unreadChatCount: 3, unreadInboxCount: 2 }));
    assert.ok(notifications.includes(i18n.t('profile.newNotifications', { count: 5 })));
    assert.equal((notifications.match(/class="profile-notification-row"/g) || []).length, 2);
    assert.ok(!notifications.includes('role="switch"'), 'no disconnected preference switches');
    const contact = renderToString(React.createElement(ProfileContactPanel, accountProps));
    assert.ok(contact.includes('America/Chicago'));
    for (const html of [personal, security, notifications, contact]) assert.ok(!/profile\.[a-zA-Z]+/.test(html), 'no untranslated profile keys');
    const company = renderToString(React.createElement(Profile, { ...accountProps, loads: [], drivers: [], initialDriverToEditId: 'not-loaded' }));
    assert.ok(company.includes('profile-company-panel'));
    assert.ok(company.includes('profile-company-tabs'));
    assert.ok(company.includes(i18n.t('drivers.noDrivers')));
  }
  console.log('Profile center: 3 locales, search, role gating, account panels, regional controls, unread counts, safe data display and company layout passed.');
} finally { await server.close(); }
