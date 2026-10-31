import { demoTrip } from './tripAnalyticsDemo.js';

export function demoDashboard(group = 'all') {
  const included = group === 'all' || group === 'completed';
  const row = { ...demoTrip, trip_date: '2026-10-02T12:00:00Z', recorded_costs: demoTrip.costs };
  return {
    total: included ? 1 : 0, pageSize: 5, counts: { all: 1, active: 0, completed: 1, planned: 0, cancelled: 0 },
    rows: included ? [row] : [],
    summary: {
      count: included ? 1 : 0, knownRates: included ? 1 : 0, knownMiles: included ? 1 : 0,
      loadedMiles: included ? row.loaded_miles : 0, contractAmount: included ? row.contract_amount : 0,
      fuelCost: included ? row.fuel_cost : 0, fuelRows: included ? 1 : 0,
      balance: included ? row.balance : 0, balancedRows: included ? 1 : 0,
    },
    dashboard: {
      monthly: included ? [{ month: '2026-10', miles: row.loaded_miles, amount: row.contract_amount, fuel: row.fuel_cost }] : [],
      lanes: included ? [{ origin: 'Houston, TX', destination: 'Dallas, TX', miles: row.loaded_miles }] : [],
      expenses: Object.fromEntries(['driver_pay', 'fuel_cost', 'toll_cost', 'other_cost'].map(key => [key, included ? row[key] : null])),
    },
  };
}

export function chartPoints(months, key) {
  const max = Math.max(1, ...months.map(item => Number(item[key]) || 0));
  return months.map((item, index) => ({
    label: item.month,
    value: item[key] == null ? null : Number(item[key]),
    x: 48 + index * (244 / Math.max(1, months.length - 1)),
    y: item[key] == null ? null : 132 - Number(item[key]) / max * 94,
  }));
}

export function expenseSegments(expenses = {}) {
  const entries = ['driver_pay', 'fuel_cost', 'toll_cost', 'other_cost'].map(key => ({ key, value: expenses[key] == null ? null : Number(expenses[key]) }));
  const total = entries.reduce((sum, entry) => sum + (entry.value || 0), 0);
  let offset = 0;
  return { total: entries.every(entry => entry.value == null) ? null : total, entries: entries.map(entry => {
    const percent = total > 0 ? (entry.value || 0) / total * 100 : 0;
    const result = { ...entry, percent, offset };
    offset += percent;
    return result;
  }) };
}
