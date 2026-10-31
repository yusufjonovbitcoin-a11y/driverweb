import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import AccountingOverview from '../../src/components/AccountingOverview.jsx';
import { sampleSettings } from '../fixtures/settlement-samples.js';

await setAppLocale('en', { persist: false });
// Seed the retired database to verify removal, then release its connection.
await new Promise((resolve, reject) => {
  const request = indexedDB.open('tfleets-accounting-demo-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => { request.result.close(); resolve(); };
});
const settings = sampleSettings();
const driver = { id: '00000000-0000-0000-0000-000000000001', name: 'Driver One' };
const load = { id: '00000000-0000-0000-0000-000000000002', loadNumber: 'LOAD-42', driverId: driver.id,
  rate: 5300, rateKnown: true, currency: 'USD', distanceMiles: 1417, distanceKnown: true,
  origin: { city: 'Santa Ana', state: 'CA' }, destination: { city: 'Burleson', state: 'TX' },
  databaseStatus: 'delivered', deliveredAt: '2026-10-13T16:00:00Z' };
const api = { readCalculationSettings: async () => structuredClone(settings), readDeliveryDates: async () => ({}), readSettlementHistory: async () => [] };
createRoot(document.getElementById('root')).render(<StrictMode><main className="workspace-main"><AccountingOverview drivers={[driver]} loads={[load]} canManageAccounting settingsApi={api} initialView={{ driver: driver.id, selected: [load.id], period: { from: '2026-10-12', to: '2026-10-18' } }} /></main></StrictMode>);
