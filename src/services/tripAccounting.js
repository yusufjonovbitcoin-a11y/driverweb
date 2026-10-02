export const accountingFields = ['additional_income', 'driver_pay', 'fuel_cost', 'toll_cost', 'other_cost', 'broker_paid'];

// Work in integer cents. Empty input is unknown, not a zero-dollar expense.
export function moneyCents(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('ACCOUNTING_INVALID');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function accountingPayload(values) {
  return Object.fromEntries(accountingFields.map((key) => {
    const cents = moneyCents(values[key]);
    return [key, cents == null ? null : (cents / 100).toFixed(2)];
  }));
}

export function accountingPreview(contract, values) {
  const cents = Object.fromEntries(accountingFields.map(key => [key, moneyCents(values[key])]));
  const rate = moneyCents(contract);
  const revenue = rate == null || cents.additional_income == null ? null : rate + cents.additional_income;
  const costs = ['driver_pay', 'fuel_cost', 'toll_cost', 'other_cost'].map(key => cents[key]);
  const totalCost = costs.some(value => value == null) ? null : costs.reduce((sum, value) => sum + value, 0);
  return {
    revenue: revenue == null ? null : revenue / 100,
    costs: totalCost == null ? null : totalCost / 100,
    balance: revenue == null || totalCost == null ? null : (revenue - totalCost) / 100,
    outstanding: revenue == null || cents.broker_paid == null ? null : (revenue - cents.broker_paid) / 100,
  };
}

export function accountingErrorKey(error) {
  const code = ['ACCOUNTING_CONFLICT', 'ACCOUNTING_PERMISSION', 'ACCOUNTING_NOT_FOUND', 'ACCOUNTING_CANCELLED', 'ACCOUNTING_INVALID', 'ANALYTICS_INVALID_FILTER'].find(code => error?.message?.includes(code));
  return `analytics.errors.${code || 'general'}`;
}
