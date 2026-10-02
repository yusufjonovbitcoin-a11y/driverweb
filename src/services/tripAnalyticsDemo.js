import { accountingPreview } from './tripAccounting.js';

// UI-only fixture: never merge into company rows/totals or submit to the API.
const fixture = {
  id: 'demo-trip-001', isDemo: true, load_number: 'DEMO-001',
  status: 'completed', trip_group: 'completed',
  driver_name: 'Demo Driver', broker_name: 'Demo Logistics',
  pickup_city: 'Houston', pickup_region: 'TX',
  delivery_city: 'Dallas', delivery_region: 'TX',
  contract_amount: 3000, loaded_miles: 240,
  additional_income: 150, driver_pay: 1200, fuel_cost: 600,
  toll_cost: 75, other_cost: 25, broker_paid: 2000,
  accounting_version: 0, notes: '',
};

export const demoTrip = Object.freeze({
  ...fixture,
  ...accountingPreview(fixture.contract_amount, fixture),
  rpm: fixture.contract_amount / fixture.loaded_miles,
});
