import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from '../../src/i18n/index';
import DriverRoster from '../../src/components/DriverRoster';
import '../../src/index.css';
import '../../src/workspace-design.css';

await i18n.changeLanguage('ru');
window.registryDownloads = [];
window.registryDownloadAborted = false;
window.registryDownloadMode = new URLSearchParams(location.search).get('case') || '';
const drivers = [{ id: 'alpha', name: 'amin', driverNumber: '#5263', truck: '110' }, { id: 'beta', name: 'Other driver', driverNumber: '#9999' }];
const item = (id, type, stop, fileName, sizeBytes = 245000) => ({ id, load_id: 'one', document_type: type, stop_id: stop, current_version_id: `v-${id}`, fileName, mimeType: 'application/pdf', sizeBytes, uploadedAt: '2026-10-02T12:12:00Z' });
const one = { id: 'one', driverId: 'alpha', loadNumber: '#2536705', databaseStatus: 'completed', status: 'COMPLETED', origin: { city: 'Hilton', state: 'NY' }, destination: { city: 'Wind Gap', state: 'PA', appointmentAt: '2026-10-02T13:01:00Z', timezone: 'America/New_York' },
  documentItems: [item('rate', 'rate_confirmation', null, 'Rate confirmation.pdf'), item('bol', 'bol', 'p1', 'Bill of lading.pdf', 1100000), item('pod1', 'pod', 'd1', 'Proof of delivery.pdf', 317000), item('pod2', 'pod', 'd2', 'Proof of delivery 2.pdf', 418000), { ...item('removed', 'pod', 'd1', 'removed.pdf'), current_version_id: null }],
  documents: {}, documentMeta: {},
};
const loads = [one, { ...one, id: 'empty', loadNumber: '#2536706', destination: { city: 'Newark', state: 'NJ' }, documentItems: [] },
  { ...one, id: 'foreign', driverId: 'beta', loadNumber: '#SECRET', documentItems: [{ ...item('secret', 'pod', 'd1', 'other-driver.pdf'), load_id: 'foreign' }] },
  ...['cancelled', 'dispute', 'in_progress'].map(status => ({ ...one, id: status, databaseStatus: status, loadNumber: `#${status}` })),
  { ...one, id: 'trashed', loadNumber: '#trash', trashedAt: '2026-10-24T12:00:00Z' },
];

export function Fixture() {
  const [selectedId, setSelectedId] = useState('alpha'), [action, setAction] = useState(null), [dark, setDark] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return <div className="workspace-shell flex"><div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100dvh', width: '100%' }}><header className="workspace-header"><h1>T Fleets · Driver documents</h1><button onClick={() => setSelectedId(selectedId === 'alpha' ? 'beta' : 'alpha')}>Switch driver</button><button onClick={() => setDark(value => !value)}>Toggle theme</button><button onClick={() => { window.registryDownloadMode = ''; }}>Restore download</button><output aria-label="Fixture action">{JSON.stringify(action)}</output></header><main className="workspace-main min-h-0 flex-1 relative overflow-y-auto p-5 space-y-4"><DriverRoster drivers={drivers} loads={loads} selectedDriverId={selectedId} onSelectDriver={setSelectedId} onOpenDocs={(load, type = 'rateCon') => setAction({ loadId: load.id, type, document: load.documentMeta?.[type] })} /></main></div></div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
