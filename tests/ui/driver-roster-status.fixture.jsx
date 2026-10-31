import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setAppLocale } from '../../src/i18n/index.js';
import DriversPage from '../../src/components/DriversPage.jsx';
import '../../src/index.css';
import '../../src/workspace-design.css';

await setAppLocale('ru', { persist: false });
const params = new URLSearchParams(location.search);
window.statusMode = params.get('mode') || '';
window.savedDriverStatus = params.get('status') || 'active';
window.statusRequests = [];
export function Fixture() {
  const [driver, setDriver] = useState({ id: 'fixture-driver', name: 'Test Driver', driverNumber: '#TEST', accountStatus: window.savedDriverStatus, dutyStatus: 'OFF_DUTY' });
  const [action, setAction] = useState('');
  return <div className="workspace-shell flex"><div className="flex-1 flex flex-col min-w-0">
    <header className="workspace-header"><h1>Водители</h1><output aria-label="Fixture action">{action}</output></header>
    <main className="workspace-main workspace-main-drivers min-h-0">
      <DriversPage drivers={[driver]} loads={[]} selectedDriverId={null} canManageDriver={params.get('role') !== 'dispatcher'}
        onSelectDriver={() => setAction('driver')} onAssignLoad={() => setAction('assign')} onOpenChat={() => setAction('chat')}
        onWorkspaceRefresh={async () => {
          if (window.statusMode === 'refresh-error') throw new Error('Synthetic refresh error');
          setDriver(current => ({ ...current, accountStatus: window.savedDriverStatus }));
        }} />
    </main>
  </div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
