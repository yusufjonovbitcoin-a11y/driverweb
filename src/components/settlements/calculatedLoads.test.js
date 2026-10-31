import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCalculatedEntry, calculatedEntry, calculatedInRange, calculatedStatementSnapshot } from './calculatedLoads.js';
import { createDemoApi, demoDrivers, demoInitialView, demoLoads } from '../../../tests/fixtures/settlement-samples.js';
import { calculateSettlement, effectiveSettings } from './calculation.js';

test('calendar filters inclusive calculation dates in the display timezone', () => {
  const entry = { calculatedAt: '2026-10-23T02:00:00Z' };
  const range = { from: '2026-10-22', to: '2026-10-22' };
  assert.equal(calculatedInRange(entry, range, 'America/New_York'), true);
  assert.equal(calculatedInRange(entry, range, 'Asia/Karachi'), false);
  assert.equal(calculatedInRange(entry, { from: '', to: '' }, 'America/New_York'), true);
  assert.equal(calculatedInRange(entry, { from: '2026-10-23', to: '' }, 'America/New_York'), false);
  assert.equal(calculatedInRange({ calculatedAt: 'bad' }, range, 'America/New_York'), false);
});

test('calculated entries preserve settings and amounts after inputs are edited', async () => {
  const record = await createDemoApi().readCalculationSettings();
  const loads = demoLoads.filter(load => demoInitialView.selected.includes(load.id));
  const calculation = calculateSettlement(loads, effectiveSettings(record, demoDrivers[0].id), demoInitialView.period);
  const entry = calculatedEntry(calculation, demoDrivers[0], record.version, '2026-10-23T10:00:00Z');
  assert.equal(entry.calculation.net, 721250);
  calculation.rows[0].load.rate = 0;
  calculation.settings.rules[0].value = '90';
  assert.equal(entry.calculation.rows[0].load.rate, 5300);
  assert.equal(entry.calculation.settings.rules[0].value, '10.00');
  assert.equal(entry.settingsVersion, 1);
});

test('repeated clicks and overlapping selected loads cannot create a double count', () => {
  const entry = calculatedEntry({ rows: [{ load: { id: 'l1' } }, { load: { id: 'l2' } }] }, { id: 'd1' }, 1);
  const entries = appendCalculatedEntry([], entry);
  assert.equal(appendCalculatedEntry(entries, entry), entries);
  const overlap = calculatedEntry({ rows: [{ load: { id: 'l2' } }, { load: { id: 'l3' } }] }, { id: 'd1' }, 2);
  assert.equal(appendCalculatedEntry(entries, overlap), entries);
});

test('PDF uses the archived calculation, driver and settings version without recalculating', () => {
  const entry = calculatedEntry({ net: 721250, rows: [{ load: { id: 'l1' } }] }, { id: 'd1', name: 'Alex' }, 7, '2026-10-23T10:00:00Z', { name: 'Saved company' });
  const snapshot = calculatedStatementSnapshot(entry);
  assert.equal(snapshot.version, 7);
  assert.equal(snapshot.driver.id, 'd1');
  assert.equal(snapshot.company.name, 'Saved company');
  assert.equal(snapshot.calculation.net, 721250);
  snapshot.calculation.net = 0;
  assert.equal(entry.calculation.net, 721250);
  assert.equal(calculatedStatementSnapshot({ ...entry, company: undefined }, true).company, undefined);
});

test('demo history calculates the other drivers using their own settings and delivered loads', async () => {
  const record = await createDemoApi().readCalculationSettings();
  const history = demoDrivers.slice(1).map(driver => calculatedEntry(calculateSettlement(
    demoLoads.filter(load => load.driverId === driver.id && load.deliveredAt),
    effectiveSettings(record, driver.id), demoInitialView.period,
  ), driver, record.version));
  assert.equal(history.length, 2);
  assert.equal(history.flatMap(entry => entry.calculation.rows).length, 4);
  assert.equal(history[0].calculation.settings.rules[0].value, '8.00');
  assert.equal(history[1].calculation.settings.rules[0].value, '10.00');
  assert(!history.flatMap(entry => entry.calculation.rows).some(row => row.load.id === 'demo-load-7'));
});
