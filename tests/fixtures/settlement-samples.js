// Synthetic fixtures for calculation/PDF tests. Never imported by the app.
import { defaultSettings, normalizeSettings } from '../../src/components/settlements/calculation.js';

export const demoDrivers = [
  { id: 'demo-driver-alex', name: 'Alex Morgan · DEMO', truck: 'UD3', email: 'alex@example.com' },
  { id: 'demo-driver-daniel', name: 'Daniel Reed · DEMO' },
  { id: 'demo-driver-sam', name: 'Sam Wilson · DEMO' },
];
const routes = [
  ['Santa Ana', 'CA', 'Burleson', 'TX', 5300, 1417, 0, 13],
  ['Temple', 'TX', 'Holland', 'MI', 3200, 1210, 0, 16],
  ['Chicago', 'IL', 'Atlanta', 'GA', 2800, 716, 1, 12],
  ['Atlanta', 'GA', 'Dallas', 'TX', 3600, 782, 1, 14],
  ['Dallas', 'TX', 'Denver', 'CO', 4100, 795, 1, 17],
  ['Phoenix', 'AZ', 'Los Angeles', 'CA', 2200, 373, 2, 13],
  ['Los Angeles', 'CA', 'Sacramento', 'CA', 1800, 384, 2, null],
];
export const demoLoads = routes.map(([from, state, to, toState, rate, miles, driverIndex, date], index) => ({
  id: `demo-load-${index + 1}`, loadNumber: `DEMO-${1001 + index}`, driverId: demoDrivers[driverIndex].id,
  rate, rateKnown: true, currency: 'USD', distanceMiles: miles, distanceKnown: true,
  origin: { city: from, state, date: date ? `2026-10-${String(date - 1).padStart(2, '0')}` : null },
  destination: { city: to, state: toState }, databaseStatus: date ? 'delivered' : 'assigned',
  deliveredAt: date ? `2026-10-${date}T16:00:00Z` : null,
}));
export const demoInitialView = { tab: 'settlements', driver: demoDrivers[0].id,
  period: { from: '2026-10-12', to: '2026-10-18' }, selected: demoLoads.slice(0, 2).map(load => load.id) };

export function sampleSettings() {
  const company = defaultSettings();
  for (const [id, value] of [['company', '10'], ['dispatch', '0.5'], ['insurance', '350'], ['eld', '45']])
    Object.assign(company.rules.find(rule => rule.id === id), { enabled: true, value });
  const override = structuredClone(company);
  Object.assign(override.rules.find(rule => rule.id === 'company'), { value: '8' });
  Object.assign(override.rules.find(rule => rule.id === 'trailer'), { enabled: true, value: '200' });
  Object.assign(override.rules.find(rule => rule.id === 'fuel'), { enabled: true, value: '375' });
  return { version: 1, broker_commission_percent: '10', settlement_defaults: { driver_settlement_v1: {
    company: normalizeSettings(company), drivers: { [demoDrivers[1].id]: normalizeSettings(override) },
  } } };
}
export const createDemoApi = () => ({ readCalculationSettings: async () => sampleSettings() });
