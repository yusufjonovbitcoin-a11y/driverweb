import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import { WorkspaceCache } from '../../src/hooks/WorkspaceCache.jsx';
import { useSettingsHistoryGuard } from '../../src/hooks/useSettingsDraft';
import ProfileView from '../../src/components/ProfileView.jsx';
import { getProfileDriver } from './profile-services.stub.js';

await setAppLocale('en', { persist: false });
const roleCode = new URLSearchParams(location.search).get('role') || 'company_admin';
const withDriver = new URLSearchParams(location.search).get('driver') === '1';
const pushUnconfigured = new URLSearchParams(location.search).get('push') === 'unconfigured';
export function Fixture() {
  useSettingsHistoryGuard();
  const [user, setUser] = useState({ id: 'fixture-user', companyId: 'fixture-company', name: 'Test Admin', company: 'Test Transport', email: 'test@example.invalid', phone: '+1 555 123 4567', roleCode });
  const [locale, setLocale] = useState('en');
  const [timeZone, setTimeZone] = useState('America/Chicago');
  const [theme, setTheme] = useState('light');
  const [saves, setSaves] = useState(0);
  const [createdMember, setCreatedMember] = useState(null);
  const [driver, setDriver] = useState(getProfileDriver);
  const [selectedDriverId, setSelectedDriverId] = useState(withDriver ? driver.id : null);
  const [pushPreferences, setPushPreferences] = useState({ calls: false, messages: false });
  return <WorkspaceCache><div className="workspace-shell" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="workspace-header" style={{ flex: 'none' }}>T Fleets <output aria-label="Profile saves">{saves}</output><output aria-label="Created member" className="sr-only">{JSON.stringify(createdMember)}</output></header>
    <main className="workspace-main" style={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
      <ProfileView drivers={withDriver ? [driver, { ...driver, id: 'suspended-driver', name: 'Paused Driver', accountStatus: 'suspended', dutyStatus: 'OFF_DUTY' }, { ...driver, id: 'available-driver', name: 'Ready Driver', dutyStatus: 'ON_DUTY', isOnline: true }] : []} members={[]} loads={withDriver ? [{ id: 'cancelled', driverId: driver.id, status: 'CANCELLED', databaseStatus: 'cancelled', loadNumber: 'CANCELLED-1' }] : []} currentUser={user} locale={locale} timeZone={timeZone} theme={theme}
        selectedDriverId={selectedDriverId} onOpenDriver={value => setSelectedDriverId(value?.id || null)}
        onDeleteMember={async () => false}
        onWorkspaceRefresh={async () => setDriver(getProfileDriver())}
        onAddDriver={async member => {
          if (member.email === 'fail@example.invalid') throw new Error('Fixture account creation failure');
          const { name, email, role, gmailLabel } = member;
          setCreatedMember({ name, email, role, gmailLabel });
        }}
        browserPush={{ status: pushUnconfigured ? 'unconfigured' : pushPreferences.calls || pushPreferences.messages ? 'on' : 'off', error: pushUnconfigured ? 'vapidKeyMissing' : null, preferences: pushPreferences,
          toggleCategory: category => setPushPreferences(previous => ({ ...previous, [category]: !previous[category] })) }}
        unreadChatCount={2} onLocaleChange={async value => { await setAppLocale(value, { persist: false }); setLocale(value); }} onTimeZoneChange={setTimeZone}
        toggleTheme={() => { document.documentElement.classList.toggle('dark'); setTheme(value => value === 'light' ? 'dark' : 'light'); }}
        onSaveProfile={async draft => { setSaves(value => value + 1); setUser(previous => ({ ...previous, ...draft })); return { full_name: draft.name, phone: draft.phone, company_name: draft.company }; }} />
    </main>
  </div></WorkspaceCache>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
