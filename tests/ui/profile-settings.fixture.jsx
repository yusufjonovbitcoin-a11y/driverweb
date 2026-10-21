import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import { WorkspaceCache } from '../../src/hooks/WorkspaceCache.jsx';
import ProfileView from '../../src/components/ProfileView.jsx';

await setAppLocale('en', { persist: false });
const roleCode = new URLSearchParams(location.search).get('role') || 'company_admin';
export function Fixture() {
  const [user, setUser] = useState({ id: 'fixture-user', companyId: 'fixture-company', name: 'Test Admin', company: 'Test Transport', email: 'test@example.invalid', phone: '+1 555 123 4567', roleCode });
  const [locale, setLocale] = useState('en');
  const [timeZone, setTimeZone] = useState('America/Chicago');
  const [theme, setTheme] = useState('light');
  const [saves, setSaves] = useState(0);
  return <WorkspaceCache><div className="workspace-shell" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="workspace-header" style={{ flex: 'none' }}>T Fleets <output aria-label="Profile saves">{saves}</output></header>
    <main className="workspace-main" style={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
      <ProfileView drivers={[]} members={[]} loads={[]} currentUser={user} locale={locale} timeZone={timeZone} theme={theme}
        unreadChatCount={2} onLocaleChange={async value => setLocale(value)} onTimeZoneChange={setTimeZone}
        toggleTheme={() => { document.documentElement.classList.toggle('dark'); setTheme(value => value === 'light' ? 'dark' : 'light'); }}
        onSaveProfile={async draft => { setSaves(value => value + 1); setUser(previous => ({ ...previous, ...draft })); return { full_name: draft.name, phone: draft.phone, company_name: draft.company }; }} />
    </main>
  </div></WorkspaceCache>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
