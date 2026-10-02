import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDriverLoad, knownLoadStatistics, loadStageIndex } from './mapLoadStatsModel.js';

test('current load belongs to the selected driver and prioritizes a trip on the road', () => {
  const loads = [
    { id: 'delivered', driverId: 'a', status: 'DELIVERED' },
    { id: 'other', driverId: 'b', status: 'ON_ROAD' },
    { id: 'moving', driverId: 'a', status: 'ON_ROAD' },
    { id: 'cancelled', driverId: 'a', status: 'COMPLETED', databaseStatus: 'cancelled' },
  ];
  assert.equal(currentDriverLoad(loads, 'a')?.id, 'moving');
  assert.equal(currentDriverLoad(loads, 'missing'), null);
});

test('stage rail follows workflow status without treating cancelled trips as complete', () => {
  assert.equal(loadStageIndex({ status: 'ASSIGNED' }), 0);
  assert.equal(loadStageIndex({ status: 'PICKED_UP' }), 1);
  assert.equal(loadStageIndex({ status: 'ON_ROAD' }), 1);
  assert.equal(loadStageIndex({ status: 'DELIVERED' }), 2);
  assert.equal(loadStageIndex({ status: 'COMPLETED', databaseStatus: 'completed' }), 3);
  assert.equal(loadStageIndex({ status: 'COMPLETED', databaseStatus: 'cancelled' }), null);
});

test('statistics do not turn missing values into zeroes', () => {
  assert.deepEqual(knownLoadStatistics({ distanceMiles: 0, distanceKnown: false, rate: 0, rateKnown: true, weightLbs: null }), {
    distance: null, weight: null, rate: 0,
  });
  assert.deepEqual(knownLoadStatistics({ distanceMiles: 57.72, distanceKnown: true, rate: 200, rateKnown: true, weightLbs: 16000 }), {
    distance: 57.72, weight: 16000, rate: 200,
  });
});
