import { defaultSettings } from '../../src/components/settlements/calculation.js';
const rules = defaultSettings();
rules.rules = rules.rules.map(rule => ['company', 'dispatch'].includes(rule.id) ? { ...rule, enabled: true, value: rule.id === 'company' ? '10.00' : '0.50' } : rule);
export const roster = [{ id: 'alpha', name: 'Test Driver Alpha', truck: '204', email: 'alpha@example.invalid', phone: '555-0101' }, { id: 'beta', name: 'Test Driver Beta', truck: '318', email: 'beta@example.invalid', phone: '555-0102' }];
const row = (id, gross, driver, date, group = 'completed') => ({ id, load_number: id.toUpperCase(), driver_id: driver, driver_name: `Test Driver ${driver}`, trip_date: date + 'T12:00:00Z', trip_group: group, status: group === 'completed' ? 'completed' : 'in_progress', contract_amount: gross, loaded_miles: 500, pickup_city: 'Boston', pickup_region: 'MA', delivery_city: 'Newark', delivery_region: 'NJ', additional_income: '0', driver_pay: null, fuel_cost: '0', toll_cost: '0', other_cost: '0', broker_paid: '0', accounting_version: 0 });
export function financialSource() {
  const rows = [row('load-a', '1000.00', 'alpha', '2026-10-01'), row('load-b', '2000.00', 'alpha', '2026-10-08'), row('load-c', '500.00', 'beta', '2026-10-09'), row('load-d', '400.00', 'beta', '2026-10-10', 'active'), row('load-e', '900.00', 'beta', '2026-10-11', 'cancelled'), row('load-f', '600.00', 'beta', '2026-10-12')];
  Object.assign(rows[0], { fuel_cost: '50.00', toll_cost: '10.00' });
  Object.assign(rows[1], { driver_pay: '1700.00', fuel_cost: null });
  return { rows, settings: { version: 1, settlement_defaults: { driver_settlement_v1: { company: rules } } },
    loads: rows.filter(item => item.id !== 'load-f').map(item => ({ id: item.id, current_assignment_id: `assignment-${item.id}` })),
    pay: [{ assignment_id: 'assignment-load-a', load_id: 'load-a', driver_id: 'alpha', amount: '800.00', currency: 'USD' }], fetchedAt: '2026-10-24T12:00:00Z' };
}
