import axe from 'axe-core';
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import Sidebar from '../../src/components/Sidebar.jsx';
import QuickDriverModal from '../../src/components/QuickDriverModal.jsx';
import DriverContactEditModal from '../../src/components/DriverContactEditModal.jsx';
import DriverVehicleAssignmentModal from '../../src/components/DriverVehicleAssignmentModal.jsx';
import DocumentViewerModal from '../../src/components/DocumentViewerModal.jsx';
import ChatTimeline from '../../src/components/ChatTimeline.jsx';
await setAppLocale('en', { persist: false });
const driver = { id: 'driver-test', name: 'Test Driver', driverNumber: 'D-101', truck: 'T-101', currentLocation: 'Chicago, IL', email: 'test@example.invalid', phone: '' };
const load = { id: 'load-test', source: 'saved', lifecycleStatus: 'ready_for_offer', origin: { city: 'Chicago', state: 'IL' }, destination: { city: 'Dallas', state: 'TX' }, rate: 2000, loadNumber: 'L-101', documents: { rateCon: '/favicon.svg' }, documentMeta: { rateCon: {mimeType: 'image/svg+xml'} }, driverBrief: { fields: [] }, equipment: 'Dry van' };
export function Fixture() {
  const [audit, setAudit] = useState(null);
  const [viewer, setViewer] = useState(false);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('profile');
  const [loggedOut, setLoggedOut] = useState(false);
  const [messages, setMessages] = useState([{ id: 'history', sender_id: 'driver', body: 'Earlier message', created_at: '2026-10-14T10:00:00Z' }]);
  return <div className="workspace-shell flex h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <Sidebar activeTab={tab} setActiveTab={setTab} loadsCount={2} unreadChatCount={3} unreadInboxCount={1} currentUser={{ name: 'Test Dispatcher', roleCode: 'company_admin' }} onLogout={() => setLoggedOut(true)} />
    <main className="min-w-0 flex-1 overflow-y-auto p-5">
      <button className="rounded-lg border p-3" onClick={async () => { const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }); setAudit(result.violations.map(({id, impact, nodes}) => ({id, impact, elements: nodes.map(node => node.target)}))); }}>Run accessibility check</button>
      <pre data-testid="audit-result">{audit && JSON.stringify(audit)}</pre>
      <h1 className="text-xl font-bold">Workspace interaction checks</h1>
      <p>Isolated synthetic data</p>
      <div className="my-5 flex flex-wrap gap-3">
        {['quick', 'contact', 'vehicle'].map(name => <button key={name} className="workspace-action rounded-lg p-3" onClick={() => setModal(name)}>Open {name}</button>)}
        <button className="rounded-lg border p-3" onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</button>
      </div>
      {loggedOut && <p role="status">Signed out</p>}
      <button className="rounded-lg border p-3" onClick={() => setMessages(rows => [...rows, { id: `new-${rows.length}`, sender_id: 'driver', body: `Arrival ${rows.length}`, created_at: new Date(Date.UTC(2026, 9, 14, 10, 1, rows.length)).toISOString() }])}>Receive test message</button>
      <div className="mt-4 flex h-48 flex-col"><ChatTimeline messages={messages} currentUserId="staff">{message => <p className="p-2">{message.body}</p>}</ChatTimeline></div>
    </main>
    {modal === 'quick' && <QuickDriverModal isOpen loadData={load} drivers={[driver]} onClose={() => setModal(null)} onOpenDocs={() => setViewer(true)} onConfirm={async () => true} />}
    {modal === 'contact' && <DriverContactEditModal driver={driver} onClose={() => setModal(null)} />}
    {viewer && <DocumentViewerModal isOpen load={load} onClose={() => setViewer(false)} />}
    {modal === 'vehicle' && <DriverVehicleAssignmentModal driver={driver} onClose={() => setModal(null)} />}
  </div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
