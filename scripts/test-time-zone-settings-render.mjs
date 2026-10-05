import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: Profile } = await server.ssrLoadModule('/src/components/ProfileView.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  const { formatTime, formatAppointment } = await server.ssrLoadModule('/src/i18n/format.js');
  const { timeZonePreference } = await server.ssrLoadModule('/src/i18n/timeZone.js');
  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const html = renderToString(React.createElement(Profile, {
      drivers: [], loads: [], currentUser: { id: 'test', roleCode: 'dispatcher', name: 'Test' },
      timeZone: 'America/Chicago',
    }));
    assert.ok(html.includes('value="America/Chicago" selected=""'), `${locale}: current choice selected`);
    assert.ok(html.includes('value="America/Phoenix"'), `${locale}: Arizona option`);
    assert.ok(html.includes(i18n.t('profile.timeZoneHint')), `${locale}: translated persistence and stop-time hint`);
    assert.ok(!html.includes('profile.timeZoneHint'), `${locale}: no raw translation keys`);
  }
  await i18n.changeLanguage('en');
  timeZonePreference.set('America/New_York');
  const before = formatTime('2026-10-05T12:00:00Z');
  const stopBefore = formatAppointment('2026-10-05T12:00:00Z', 'America/Chicago');
  timeZonePreference.set('America/Los_Angeles');
  assert.notEqual(formatTime('2026-10-05T12:00:00Z'), before, 'shared formatter follows preference');
  assert.equal(formatAppointment('2026-10-05T12:00:00Z', 'America/Chicago'), stopBefore, 'stop formatter remains independent');
  console.log('Time-zone settings: three locales, selected value, shared timestamps, independent appointments passed.');
} finally { await server.close(); }
