import test from 'node:test';
import assert from 'node:assert/strict';
import { financialCsv, financialView } from './financialModel.js';
import { financialSource, roster } from '../../../tests/ui/financial-source.js';
import { calculateSettlement, effectiveSettings } from '../settlements/calculation.js';
import { approveSettlement, reviewSettlement, settlementDraft } from '../settlements/settlementReviewModel.js';
import { allocateCents } from './financialAllocation.js';

test('internal references distinguish repeated broker numbers without changing financial totals', () => {
  const source = financialSource();
  const before = financialView(source, { group: 'all' }, roster);
  for (const [index, row] of source.rows.slice(0, 2).entries()) {
    row.internal_number = 100 + index; row.load_number = 'BROKER-SAME';
  }
  const result = financialView(source, { group: 'all', search: 'BROKER-SAME' }, roster);
  const all = financialView(source, { group: 'all' }, roster);
  assert.deepEqual(all.totals, before.totals);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(all.rows.filter(row => row.internalNumber).map(row => row.number)).size, 2);
  assert.equal(result.rows.find(row => row.internalNumber === '100')?.brokerLoadNumber, '#BROKER-SAME');
});

test('unknown document mileage uses only a finite matching assignment snapshot',()=>{
 const source=financialSource();source.rows[0].loaded_miles=0;source.pay[0].loaded_miles='288.23';
 assert.equal(financialView(source,{},roster).rows.find(row=>row.id==='load-a').miles,288.23);
 source.pay[0].driver_id='other-driver';assert.equal(financialView(source,{},roster).rows.find(row=>row.id==='load-a').miles,0);
 source.pay[0].driver_id='alpha';source.pay[0].loaded_miles=Infinity;assert.equal(financialView(source,{},roster).rows.find(row=>row.id==='load-a').miles,0);
 source.pay[0].loaded_miles=288.23;source.rows[0].loaded_miles=500;assert.equal(financialView(source,{},roster).rows.find(row=>row.id==='load-a').miles,500);
});

test('live view excludes cancelled/trash and uses manual or current assignment pay before estimates', () => {
  const result = financialView(financialSource(), {}, roster);
  assert.equal(result.rows.length, 3);
  assert.equal(result.totals.gross, 350000);
  assert.equal(result.totals.company, 35000);
  assert.equal(result.totals.dispatch, 1750);
  assert.equal(result.totals.net, 294750);
  assert.equal(result.totals.adjustment, 18500);
  assert.equal(result.totals.operating, null);
  assert.equal(result.totals.profit, null);
  assert.deepEqual(result.rows.map(row => row.netSource), ['assignment', 'accounting', 'settings']);
  assert.equal(result.counts.active, 1);
  assert.equal(result.counts.all, 4);
  assert.equal(result.drivers[0].name, 'Test Driver Alpha');
});
test('periodic allocations stay stable when searching or filtering drivers', () => {
  const source = financialSource();
  const rule = source.settings.settlement_defaults.driver_settlement_v1.company.rules.find(item => item.id === 'insurance');
  Object.assign(rule, { enabled: true, value: '70.00' });
  const all = financialView(source, { from: '2026-10-01', to: '2026-10-14' }, roster);
  const filtered = financialView(source, { from: '2026-10-01', to: '2026-10-14', search: 'LOAD-A' }, roster);
  assert.equal(filtered.rows[0].other, all.rows[0].other);
  assert.equal(all.rows.filter(row => row.driverId === 'alpha').reduce((sum, row) => sum + row.other, 0), 14000);
});
test('missing rules, costs and rates stay unknown; explicit zeros stay zero', () => {
  const source = financialSource(); source.settings = null; source.rows[2].contract_amount = null;
  const result = financialView(source, {}, roster);
  assert.equal(result.totals.company, null);
  assert.equal(result.totals.gross, null);
  assert.equal(result.rows[2].net, null);
  assert.equal(result.rows[2].operating, 0);
  assert.equal(result.totals.unknownGross, 1);
  assert.equal(result.totals.unknownNet, 1);
  const csv = financialCsv(result.rows);
  assert.ok(csv.includes('"LOAD-C"'));
  assert.ok(!csv.includes('NaN'));
});
test('old or incorrectly scoped payment snapshots never become current pay', () => {
  for (const patch of [{ assignment_id: 'old' }, { driver_id: 'beta' }, { load_id: 'load-b' }, { currency: 'EUR' }]) {
    const source = financialSource(); Object.assign(source.pay[0], patch); source.settings = null;
    assert.equal(financialView(source, {}, roster).rows[0].net, null);
  }
});
test('search, date and group filters reconcile tables, drivers, charts and CSV', () => {
  const source = financialSource();
  const result = financialView(source, { group: 'active', search: 'beta' }, roster);
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.gross, 40000);
  assert.equal(result.daily[0].gross, result.totals.gross);
  assert.equal(result.drivers[0].net, result.totals.net);
  assert.match(financialCsv(result.rows), /"LOAD-D","Test Driver Beta"/);
  assert.equal(financialView(source, { from: '2026-10-10', to: '2026-10-01' }, roster).rows.length, 0);
  assert.equal(financialView({}, {}, roster).totals.gross, 0);
});

test('a fixed driver scope limits every row, status count, chart, total and export', () => {
  const source = financialSource();
  const alpha = financialView(source, { scopeDriverId: 'alpha' }, roster);
  assert.deepEqual(alpha.counts, { all: 2, completed: 2, active: 0, planned: 0 });
  assert.deepEqual(alpha.rows.map(row => row.id), ['load-a', 'load-b']);
  assert.equal(alpha.totals.gross, 300000);
  assert.equal(alpha.totals.net, 250000);
  assert.deepEqual(alpha.drivers.map(driver => driver.id), ['alpha']);
  assert.equal(alpha.daily.reduce((sum, day) => sum + day.gross, 0), alpha.totals.gross);
  assert.doesNotMatch(financialCsv(alpha.rows), /LOAD-C|LOAD-D|Test Driver Beta/);
  assert.equal(financialView(source, { scopeDriverId: 'alpha', driverId: 'beta', group: 'all' }, roster).rows.length, 0);
  assert.equal(financialView(source, { scopeDriverId: 'alpha', search: 'LOAD-C', group: 'all' }, roster).rows.length, 0);
  assert.equal(financialView(source, { scopeDriverId: 'alpha', group: 'active' }, roster).rows.length, 0);
  const missing = financialView(source, { scopeDriverId: 'no-trips', group: 'all' }, roster);
  assert.deepEqual(missing.counts, { all: 0, completed: 0, active: 0, planned: 0 });
  assert.equal(missing.totals.gross, 0);
});

test('a driver page uses the same periodic deductions as the company report', () => {
  const source = financialSource();
  Object.assign(source.settings.settlement_defaults.driver_settlement_v1.company.rules.find(rule => rule.id === 'insurance'), { enabled: true, value: '70.00' });
  for (const period of [{}, { from: '2026-10-01', to: '2026-10-14' }]) {
    const company = financialView(source, period, roster);
    const scoped = financialView(source, { ...period, scopeDriverId: 'alpha' }, roster);
    assert.deepEqual(scoped.rows, company.rows.filter(row => row.driverId === 'alpha'));
  }
});

test('approved PDF rows, commissions and final Net stay frozen across rule changes and filters', () => {
  const source = financialSource();
  const loads = source.rows.slice(0,2).map(row => ({ id:row.id, loadNumber:row.load_number, driverId:row.driver_id, rate:row.contract_amount }));
  const original = { driver:roster[0], version:1, company:{name:'Test'}, calculation:calculateSettlement(loads,effectiveSettings(source.settings,'alpha'),{from:'2026-10-01',to:'2026-10-14'}) };
  const draft = settlementDraft(original); draft.netOverride='2200.01'; draft.loads[0].netOverride='850';
  draft.loads[0].rate='1200'; // Only this PDF changes; the broker still owes the contracted $1,000.
  const approved = approveSettlement(reviewSettlement(original,draft));
  source.settlements=[{id:approved.deliveryId,number:1,driverId:'alpha',calculation:approved.calculation}];
  const before = financialView(source,{scopeDriverId:'alpha'},roster);
  assert.equal(before.totals.net,220001);
  assert.equal(before.totals.company,32000);
  assert.equal(before.totals.gross,320000);
  assert.equal(before.totals.contractGross,300000);
  assert.equal(before.totals.revenue,300000);
  assert.equal(before.totals.outstanding,300000);
  assert.equal(before.totals.approvedCount,2);
  assert.ok(before.rows.every(row=>row.netSource==='approved'));
  for (const row of before.rows) assert.equal(row.gross,row.company+row.dispatch+row.other+row.net+row.adjustment);
  source.settings.settlement_defaults.driver_settlement_v1.company.rules.find(rule=>rule.id==='company').value='20';
  assert.deepEqual(financialView(source,{scopeDriverId:'alpha'},roster).totals,before.totals);
  const filtered = financialView(source,{from:'2026-10-01',to:'2026-10-01',search:'LOAD-A'},roster);
  assert.equal(filtered.rows[0].net,before.rows[0].net);
  assert.match(financialCsv(filtered.rows),/Approved statement/);
});

test('allocation reconciles signed adjustments, fractional cents and zero Gross', () => {
  assert.deepEqual(allocateCents(100,[1,1,1]),[34,33,33]);
  assert.deepEqual(allocateCents(-100,[1,1,1]),[-34,-33,-33]);
  assert.deepEqual(allocateCents(5,[0,0]),[3,2]);
});

test('local midnight, DST and explicit timezone are used by both filters and daily totals', () => {
  const source = financialSource();
  source.rows[0].trip_date='2026-10-02T00:30:00Z';
  assert.equal(financialView(source,{from:'2026-10-01',to:'2026-10-01'},roster).rows[0].date,'2026-10-01');
  assert.equal(financialView(source,{from:'2026-10-01',to:'2026-10-01',timeZone:'UTC'},roster).rows.length,0);
  source.rows[0].trip_date='2026-11-01T04:30:00Z';
  const result=financialView(source,{from:'2026-11-01',to:'2026-11-01'},roster);
  assert.equal(result.rows.length,1); assert.equal(result.daily[0].date,'2026-11-01');
});

test('income, broker cash, receivables and trip balance reconcile without replacing unknowns with zeros', () => {
  const source=financialSource();
  Object.assign(source.rows[0],{additional_income:'100',driver_pay:'900',broker_paid:'1000'});
  const result=financialView(source,{search:'LOAD-A'},roster);
  assert.equal(result.totals.revenue,110000);assert.equal(result.totals.brokerPaid,100000);
  assert.equal(result.totals.outstanding,10000);assert.equal(result.totals.tripBalance,14000);
  source.rows[0].additional_income=null;
  const unknown=financialView(source,{search:'LOAD-A'},roster);
  assert.equal(unknown.totals.revenue,null);assert.equal(unknown.totals.outstanding,null);
});
