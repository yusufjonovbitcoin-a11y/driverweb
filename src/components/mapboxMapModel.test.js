import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMapboxGeometry,
  shouldFitMapbox,
  validMapCoordinate,
} from './mapboxMapModel.js';

test('builds a Mapbox line from valid GPS points and keeps the live position', () => {
  const geometry = buildMapboxGeometry([
    { latitude: '40.1', longitude: '-75.2' },
    { latitude: 120, longitude: -75.3 },
    { latitude: 40.3, longitude: -75.4 },
  ], { lat: 40.4, lng: -75.5 });

  assert.deepEqual(geometry.lineCoordinates, [
    [-75.2, 40.1],
    [-75.4, 40.3],
  ]);
  assert.deepEqual(geometry.start, { lat: 40.1, lng: -75.2 });
  assert.deepEqual(geometry.end, { lat: 40.3, lng: -75.4 });
  assert.deepEqual(geometry.live, { lat: 40.4, lng: -75.5 });
  assert.equal(geometry.focusPoints.length, 3);
});

test('rejects coordinates outside Mapbox latitude and longitude ranges', () => {
  assert.equal(validMapCoordinate(90, 180), true);
  assert.equal(validMapCoordinate(-91, 0), false);
  assert.equal(validMapCoordinate(0, 181), false);
  assert.equal(validMapCoordinate(undefined, 0), false);
  assert.equal(validMapCoordinate(null, null), false);
});

test('fits once per route and again when an initially empty track arrives', () => {
  assert.equal(shouldFitMapbox(null, 'driver-a:load-a', false), true);
  assert.equal(shouldFitMapbox({ routeKey: 'driver-a:load-a', hasRoute: false }, 'driver-a:load-a', true), true);
  assert.equal(shouldFitMapbox({ routeKey: 'driver-a:load-a', hasRoute: true }, 'driver-a:load-a', true), false);
  assert.equal(shouldFitMapbox({ routeKey: 'driver-a:load-a', hasRoute: true }, 'driver-a:load-b', true), true);
});
