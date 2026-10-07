import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDriverTrackRows } from './trackingQueries.js';

test('refresh includes late old capture times and all pages instead of an advancing capture cursor', async () => {
  let rows = [{ id: 'new', captured_at: '2026-10-06T12:00:00Z' }];
  const requests = [];
  const client = { from: table => {
    assert.equal(table, 'driver_location_points');
    const filters = [];
    return { select() { return this; }, eq(...args) { filters.push(args); return this; },
      order() { return this; }, range(from, to) {
        requests.push({ from, to, filters });
        return { data: rows.toSorted((a, b) => a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id)).slice(from, to + 1) };
      } };
  } };
  assert.equal((await fetchDriverTrackRows(client, 'driver', 'load')).length, 1);
  rows = [...rows, ...Array.from({ length: 1001 }, (_, i) => ({ id: `old-${i}`, captured_at: '2026-10-06T10:00:00Z' }))];
  const refreshed = await fetchDriverTrackRows(client, 'driver', 'load');
  assert.equal(refreshed.length, 1002); assert.equal(refreshed.at(-1).id, 'new');
  assert.deepEqual(requests.map(r => r.from), [0, 0, 1000]);
  assert.deepEqual(requests[1].filters, [['driver_id', 'driver'], ['load_id', 'load']]);
});
