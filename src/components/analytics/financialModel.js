import { moneyCents } from '../../services/tripAccounting.js';
import { calculateSettlement, effectiveSettings } from '../settlements/calculation.js';
import { hasSavedSettings } from '../settlements/eligibility.js';
import { displayDayKey, DEFAULT_TIME_ZONE } from '../../i18n/timeZone.js';
import { allocateCents, settlementAllocations } from './financialAllocation.js';
import { loadIdentity } from '../../services/loadIdentity.js';

const amountKeys = ['gross', 'company', 'dispatch', 'other', 'net', 'operating', 'profit', 'adjustment', 'miles', 'contractGross', 'additionalIncome', 'revenue', 'brokerPaid', 'outstanding', 'tripBalance'];
const cents = value => { try { return moneyCents(value); } catch { return null; } };
const strictSum = values => values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0);
function share(amount, rows) {
  if (amount == null) return rows.map(() => null);
  return allocateCents(amount, rows.map(row => row.gross));
}
export function financialTotals(rows) {
  return { count: rows.length, ...Object.fromEntries(amountKeys.map(key => [key, strictSum(rows.map(row => row[key]))])),
    unknownGross: rows.filter(row => row.gross == null).length, unknownNet: rows.filter(row => row.net == null).length,
    unknownOperating: rows.filter(row => row.operating == null).length,
    approvedCount: rows.filter(row => row.netSource === 'approved').length,
    recordedCount: rows.filter(row => row.netSource === 'accounting' || row.netSource === 'assignment').length,
    estimatedCount: rows.filter(row => row.netSource === 'settings').length };
}

function groups(rows, key) {
  const grouped = new Map();
  for (const row of rows) { const value = row[key]; if (!grouped.has(value)) grouped.set(value, []); grouped.get(value).push(row); }
  return grouped;
}

export function prepareFinancialView(source = {}, { from = '', to = '', scopeDriverId = '', group = 'completed', timeZone = DEFAULT_TIME_ZONE } = {}, roster = []) {
  const available = new Map((source.loads || []).map(load => [load.id, load]));
  const members = new Map(roster.map(driver => [driver.id, driver]));
  const savedPay = new Map((source.pay || []).map(pay => [pay.assignment_id, pay]));
  const confirmed = new Map((source.settlements || []).flatMap(statement => settlementAllocations(statement).map(row => [row.id, row])));
  const days = new Map();
  const base = (source.rows || []).filter(row => available.has(row.id) && row.trip_group !== 'cancelled').map(raw => {
    const driver = members.get(raw.driver_id), assignment = available.get(raw.id).current_assignment_id;
    const snapshot = savedPay.get(assignment);
    const snapshotNet = snapshot?.load_id === raw.id && snapshot.driver_id === raw.driver_id && snapshot.currency === 'USD' ? cents(snapshot.amount) : null;
    const frozenMiles = snapshotNet != null && snapshot.loaded_miles != null && Number.isFinite(Number(snapshot.loaded_miles)) && Number(snapshot.loaded_miles) > 0 ? Number(snapshot.loaded_miles) : null;
    const recordedNet = cents(raw.driver_pay);
    if (!days.has(raw.trip_date)) days.set(raw.trip_date, displayDayKey(raw.trip_date, timeZone));
    const date = days.get(raw.trip_date);
    const operating = strictSum([raw.fuel_cost, raw.toll_cost, raw.other_cost].map(cents));
    const approved = confirmed.get(raw.id);
    const identity = loadIdentity(raw);
    const row = { id: raw.id, number: identity.internalNumber ? identity.loadNumber : raw.load_number || '—', ...identity, driverId: raw.driver_id || 'unassigned', driverName: driver?.name || raw.driver_name || '—',
      truck: driver?.vehicle?.number || driver?.truck || '—', email: driver?.email || '—', phone: driver?.phone || '—',
      date, origin: [raw.pickup_city, raw.pickup_region].filter(Boolean).join(', ') || '—', destination: [raw.delivery_city, raw.delivery_region].filter(Boolean).join(', ') || '—',
      group: raw.trip_group, status: raw.status, gross: cents(raw.contract_amount), miles: Number(raw.loaded_miles) > 0 ? Number(raw.loaded_miles) : frozenMiles ?? (raw.loaded_miles == null ? null : Number(raw.loaded_miles)),
      company: null, dispatch: null, other: null, net: recordedNet ?? snapshotNet, operating, profit: null, adjustment: null,
      netSource: recordedNet != null ? 'accounting' : snapshotNet != null ? 'assignment' : 'unknown',
      contractGross: cents(raw.contract_amount), additionalIncome: cents(raw.additional_income), brokerPaid: cents(raw.broker_paid), raw };
    if (approved) {
      Object.assign(row, approved);
      const approvedDriver = members.get(approved.driverId);
      row.driverName = approvedDriver?.name || (approved.driverId === raw.driver_id ? row.driverName : '—');
      row.truck = approvedDriver?.vehicle?.number || approvedDriver?.truck || '—';
      row.email = approvedDriver?.email || '—'; row.phone = approvedDriver?.phone || '—';
    }
    return row;
  });
  const scopeRows = scopeDriverId ? base.filter(row => row.driverId === scopeDriverId) : base;
  const counts = { all: scopeRows.length, completed: scopeRows.filter(row => row.group === 'completed').length, active: scopeRows.filter(row => row.group === 'active').length, planned: scopeRows.filter(row => row.group === 'planned').length };
  // Calculate periodic deductions before search/driver filters, keeping each
  // load's allocated share stable when opening a driver or a single-load report.
  const periodRows = base.filter(row => (group === 'all' || row.group === group) && (!from || row.date >= from) && (!to || row.date <= to));
  const dates = periodRows.map(row => row.date).filter(Boolean).sort();
  const period = { from: from || dates[0], to: to || dates.at(-1) };
  for (const [id, rows] of groups(periodRows.filter(row => row.netSource !== 'approved'), 'driverId')) {
    if (!hasSavedSettings(source.settings, id) || id === 'unassigned' || rows.some(row => row.gross == null) || !period.from || !period.to) continue;
    try {
      const calculation = calculateSettlement(rows.map(row => ({ id: row.id, driverId: id, rate: (row.gross / 100).toFixed(2), rateKnown: true, distanceMiles: row.miles })), effectiveSettings(source.settings, id), period);
      const dispatchTotal = calculation.deductions.filter(rule => rule.id === 'dispatch').reduce((sum, rule) => sum + rule.amount, 0);
      const otherTotal = calculation.deducted - dispatchTotal;
      const dispatch = share(dispatchTotal, rows), other = share(otherTotal, rows);
      rows.forEach((row, index) => {
        row.company = calculation.rows[index].commission; row.dispatch = dispatch[index]; row.other = other[index];
        if (row.net == null) { row.net = row.gross - row.company - row.dispatch - row.other; row.netSource = 'settings'; }
      });
    } catch { /* Invalid/incomplete saved rules stay visibly unknown. */ }
  }
  for (const row of periodRows) {
    if (row.company != null && row.operating != null) row.profit = row.company - row.operating;
    const allocated = strictSum([row.company, row.dispatch, row.other, row.net]);
    row.adjustment = allocated == null || row.gross == null ? null : row.gross - allocated;
    // PDF-only Gross edits change the approved settlement basis, not the
    // broker's contractual receivable or the source load's rate.
    row.revenue = strictSum([row.contractGross, row.additionalIncome]);
    row.outstanding = row.revenue == null || row.brokerPaid == null ? null : row.revenue - row.brokerPaid;
    row.tripBalance = row.revenue == null || row.net == null || row.operating == null ? null : row.revenue - row.net - row.operating;
  }
  return summarizeFinancialRows(periodRows.filter(row => !scopeDriverId || row.driverId === scopeDriverId), { counts, period });
}

function summarizeFinancialRows(rows, metadata) {
  const drivers = [...groups(rows, 'driverId')].map(([id, driverRows]) => {
    const first = driverRows[0];
    return { id, name: first.driverName, truck: first.truck, email: first.email, phone: first.phone, ...financialTotals(driverRows) };
  });
  const daily = [...groups(rows.filter(row => row.date), 'date')].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayRows]) => ({ date, ...financialTotals(dayRows) }));
  return { ...metadata, rows, drivers, daily, totals: financialTotals(rows) };
}

export function filterFinancialView(prepared, { search = '', driverId = '' } = {}) {
  const query = search.trim().toLowerCase();
  if (!query && !driverId) return prepared;
  const rows = prepared.rows.filter(row => (!driverId || row.driverId === driverId) && (!query || [row.number, row.brokerLoadNumber, row.origin, row.destination, row.driverName, row.truck, row.raw.broker_name].join(' ').toLowerCase().includes(query)));
  return summarizeFinancialRows(rows, { counts: prepared.counts, period: prepared.period });
}

export function financialView(source, filters = {}, roster) {
  return filterFinancialView(prepareFinancialView(source, filters, roster), filters);
}
export function financialCsv(rows) {
  const fields = [['T Fleets — financial analytics (not payment confirmation)'], ['Load', 'Driver', 'Route', 'Date', 'Gross USD', 'Company USD', 'Dispatcher USD', 'Other deductions USD', 'Driver net USD', 'Company costs USD', 'Commission less costs USD', 'Adjustments / unallocated USD', 'Payout source', 'Additional income USD', 'Revenue USD', 'Broker received USD', 'Broker outstanding USD', 'Trip balance USD'],
    ...rows.map(row => [row.number, row.driverName, `${row.origin} → ${row.destination}`, row.date,
      ...['gross', 'company', 'dispatch', 'other', 'net', 'operating', 'profit', 'adjustment'].map(key => row[key] == null ? '' : (row[key] / 100).toFixed(2)), ({approved:'Approved statement; common deductions allocated by Gross',accounting:'Recorded in accounting',assignment:'Saved assignment pay',settings:'Saved calculation settings',unknown:'No calculation'})[row.netSource],
      ...['additionalIncome', 'revenue', 'brokerPaid', 'outstanding', 'tripBalance'].map(key => row[key] == null ? '' : (row[key] / 100).toFixed(2))])];
  return '\uFEFF' + fields.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
