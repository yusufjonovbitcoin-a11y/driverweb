import test from 'node:test';
import assert from 'node:assert/strict';
import { chartPoints, expenseSegments, demoDashboard } from './analyticsDashboard.js';

test('chart keeps unknown values as gaps and real zeros at the baseline', () => {
  const points = chartPoints([{ month: '2026-08', fuel: null }, { month: '2026-09', fuel: 0 }, { month: '2026-10', fuel: 100 }], 'fuel');
  assert.equal(points[0].y, null);
  assert.equal(points[1].y, 132);
  assert.equal(points[2].y, 38);
  assert.equal(points[2].x, 292);
});

test('chart handles empty and one-month data without invalid coordinates', () => {
  assert.deepEqual(chartPoints([], 'miles'), []);
  const [point] = chartPoints([{ month: '2026-10', miles: 240 }], 'miles');
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('expense donut uses entered values only and never invents missing expenses', () => {
  const result = expenseSegments({ driver_pay: 300, fuel_cost: 100, toll_cost: null });
  assert.equal(result.total, 400);
  assert.deepEqual(result.entries.map(entry => entry.percent), [75, 25, 0, 0]);
  assert.equal(result.entries[2].value, null);
  assert.equal(expenseSegments().total, null);
  assert.equal(expenseSegments({ driver_pay: 0 }).total, 0);
});

test('demo source contains exactly one trip and is isolated from real data', () => {
  const demo = demoDashboard();
  assert.equal(demo.total, 1);
  assert.equal(demo.rows[0].isDemo, true);
  assert.equal(demo.summary.balance, 1250);
  assert.equal(demo.dashboard.monthly[0].fuel, 600);
  assert.equal(demoDashboard('active').rows.length, 0);
  assert.equal(demoDashboard('completed').rows.length, 1);
  demo.rows.length = 0;
  assert.equal(demoDashboard().rows.length, 1);
});
