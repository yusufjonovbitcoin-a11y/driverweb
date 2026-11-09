import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import SamsaraIntegrationPanel from '../../src/components/SamsaraIntegrationPanel.jsx';
const params = new URLSearchParams(location.search);
await setAppLocale(params.get('locale') || 'en', { persist: false });
if (params.get('dark')) document.documentElement.classList.add('dark');
const state = params.get('state') || 'active';
let statusCalls = 0;
window.samsaraActions = [];
const fixture = { configured: true, connection: state === 'disconnected' ? null : {
  status: state === 'reconnect' ? 'needs_reconnect' : 'active', lastSyncedAt: '2026-11-09T00:00:00Z', syncing: false,
  capabilities: { vehicles: 'ok', drivers: 'ok', gps: 'ok', hos: state === 'partial' ? 'SCOPE_REQUIRED' : 'ok' },
  lastError: state === 'partial' ? 'PARTIAL_SYNC' : null,
  vehicles: [{ id: 'v1', name: 'Truck 104', vin: 'TEST-VIN', latitude: 40.7, longitude: -74.0, gpsAt: '2026-11-08T23:55:00Z', location: 'New York, NY' }],
  drivers: [{ id: 'd1', name: 'Test Driver', vehicleId: 'v1', driveRemainingMs: 0, shiftRemainingMs: 3600000 }],
} };
async function request(action) {
  window.samsaraActions.push(action);
  if (action === 'status') {
    statusCalls++;
    if (state === 'error' && statusCalls === 1) throw new Error('REQUEST_FAILED');
    return fixture;
  }
  if (action === 'connect') return { url: 'https://api.samsara.com/oauth2/authorize?client_id=fixture&state=fixture-state&response_type=code' };
  if (action === 'disconnect') { fixture.connection = null; return fixture; }
  return { queued: true };
}
createRoot(document.getElementById('root')).render(<SWRConfig value={{ provider: () => new Map() }}><main className="workspace-shell" style={{ minHeight: '100vh', padding: 20 }}><h1>Integrations</h1><SamsaraIntegrationPanel currentUser={{id:'fixture',companyId:'fixture-company',roleCode:params.get('role') || 'company_admin'}} request={request} /></main></SWRConfig>);
