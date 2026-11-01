import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MemberAvatar from '../../src/components/MemberAvatar.jsx';
import DriverRosterList from '../../src/components/DriverRosterList.jsx';
import { setAppLocale } from '../../src/i18n/index.js';
import '../../src/index.css';
import '../../src/workspace-design.css';

await setAppLocale('ru', { persist: false });
const mode = new URLSearchParams(location.search).get('mode') || 'portrait';
window.avatarRenewals = [];
const original = { id: 'driver-a', name: 'Test Driver', avatarPath: 'cloudinary:avatar-a',
  avatar: mode === 'portrait' ? '/test-avatar-portrait.svg' : '/test-avatar-expired.svg' };
const resolveAvatar = async member => {
  window.avatarRenewals.push(member.id);
  if (mode === 'deferred') return new Promise(resolve => { window.finishAvatarRenewal = resolve; });
  if (mode === 'failure') throw new Error('Offline');
  return mode === 'invalid-renewal' ? '/test-avatar-missing.svg' : '/test-avatar-portrait.svg';
};
export function Fixture() {
  const [member, setMember] = useState(original);
  return <main style={{ padding: 20 }}>
    <section aria-label="Avatar recovery"><MemberAvatar member={member} className="drivers-roster-avatar" alt="Driver portrait" resolveAvatar={resolveAvatar} /></section>
    <button onClick={() => setMember({ ...original, id: 'driver-b', name: 'Second Driver', avatarPath: 'cloudinary:avatar-b', avatar: '/test-avatar-other.svg' })}>Change member</button>
    <button onClick={() => setMember({ ...original, avatar: '/test-avatar-other.svg' })}>Change source</button>
    {mode === 'portrait' && <DriverRosterList drivers={[{ ...original, driverNumber: '#TEST', accountStatus: 'active' }]}
      loads={[]} onOpenDriver={() => {}} onAssignLoad={() => {}} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
