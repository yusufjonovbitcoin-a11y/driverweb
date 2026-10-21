// Decimal input is converted to integers before any financial calculation.
function scaledDecimal(value, places) {
  if (value == null || value === '') return null;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d*))?$/);
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(places + 1, '0');
  const scaled = BigInt(match[1]) * (10n ** BigInt(places)) + BigInt(fraction.slice(0, places) || '0') + (fraction[places] >= '5' ? 1n : 0n);
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) : null;
}
export const moneyCents = value => scaledDecimal(value, 2);
export function percentageBasisPoints(value) {
  if (!/^(?:\d+)(?:\.\d{0,2})?$/.test(String(value).trim())) return null;
  const points = scaledDecimal(value, 2);
  return points != null && points <= 10000 ? points : null;
}
export function commissionCents(amount, basisPoints) {
  if (amount == null || basisPoints == null) return null;
  return Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
}

export function loadRateCents(load) {
  return load.rateKnown === false ? null : moneyCents(load.rate);
}

export function isAssignedAccountingLoad(load) {
  const currency = load.currency || load.currencyCode;
  return Boolean(load.driverId) && (!currency || String(currency).toUpperCase() === 'USD');
}

export function accountingMiles(load) {
  if (load.distanceKnown === false || load.distanceMiles == null || load.distanceMiles === '') return null;
  const miles = Number(load.distanceMiles);
  return Number.isFinite(miles) && miles >= 0 ? miles : null;
}
export function accountingDeliveryTimestamp(load) {
  // Appointment dates are planned, not evidence of delivery completion.
  const value = load.deliveredAt;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}
export function accountingLedgerTotals(loads, basisPoints) {
  let gross = 0, miles = 0, pay = 0, unknownGross = 0, unknownMiles = 0;
  for (const load of loads) {
    const amount = loadRateCents(load), distance = accountingMiles(load);
    if (amount == null) unknownGross++; else { gross += amount; if (basisPoints != null) pay += amount - commissionCents(amount, basisPoints); }
    if (distance == null) unknownMiles++; else miles += distance;
  }
  return { gross: unknownGross ? null : gross, miles: unknownMiles ? null : miles,
    pay: unknownGross || basisPoints == null ? null : pay,
    rate: unknownGross || unknownMiles || miles <= 0 ? null : gross / 100 / miles };
}
