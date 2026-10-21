import test from 'node:test';
import assert from 'node:assert/strict';
import { labelMapStops } from './mapStopLabels.js';
import { validMapStops } from './mapboxMapModel.js';

test('single role stops use P and D while repeated roles number independently in route order', () => {
  for (const [roles, labels] of [
    [['pickup', 'delivery'], ['P', 'D']],
    [['pickup', 'pickup', 'delivery'], ['P1', 'P2', 'D']],
    [['pickup', 'delivery', 'delivery'], ['P', 'D1', 'D2']],
    [['pickup', 'delivery', 'pickup', 'delivery'], ['P1', 'D1', 'P2', 'D2']],
  ]) assert.deepEqual(labelMapStops(roles.map(role => ({ role }))).map(stop => stop.markerLabel), labels);
});
test('invalid coordinates are omitted without renumbering remaining stops or mutating inputs', () => {
  const stops = [{ role: 'pickup' }, { role: 'pickup', latitude: 40, longitude: -70 },
    { role: 'delivery', latitude: 41, longitude: -71 }];
  assert.deepEqual(validMapStops(labelMapStops(stops)).map(stop => stop.markerLabel), ['P2', 'D']);
  assert.equal(stops[1].markerLabel, undefined);
});
