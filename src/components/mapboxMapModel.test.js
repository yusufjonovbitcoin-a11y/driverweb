import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMapboxGeometry,
  mapboxFocusPoints,
  mapboxLineFeatures,
  shouldFitMapbox,
  validMapCoordinate,
  validMapStops,
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

test('completed route line follows raw GPS coordinates without road snapping', () => {
  const points = [{ latitude: 40, longitude: -75, assignment_id: 'a' },
    { latitude: 40.2, longitude: -75.4, assignment_id: 'a' },
    { latitude: 40.4, longitude: -75.1, assignment_id: 'a' }];
  assert.deepEqual(mapboxLineFeatures(points, true)[0].geometry.coordinates, [[-75, 40], [-75.4, 40.2], [-75.1, 40.4]]);
  assert.deepEqual(mapboxLineFeatures([], true), []);
  assert.deepEqual(mapboxLineFeatures(points.slice(0, 1), true), []);
});

test('GPS lines do not invent links between assignments or across invalid samples', () => {
  const features = mapboxLineFeatures([
    { latitude: 40, longitude: -75, assignment_id: 'a' }, { latitude: 41, longitude: -74, assignment_id: 'a' },
    { latitude: 42, longitude: -73, assignment_id: 'b' }, { latitude: 43, longitude: -72, assignment_id: 'b' },
    { latitude: null, longitude: null, assignment_id: 'b' },
    { latitude: 44, longitude: -71, assignment_id: 'b' }, { latitude: 45, longitude: -70, assignment_id: 'b' },
  ], true);
  assert.deepEqual(features.map(feature => feature.geometry.coordinates), [
    [[-75, 40], [-74, 41]], [[-73, 42], [-72, 43]], [[-71, 44], [-70, 45]],
  ]);
});

test('planned geometry preserves every bend returned by the road API', () => {
  const points = [{ latitude: 40, longitude: -75 }, { latitude: 40.8, longitude: -75.2 }, { latitude: 41, longitude: -74 }];
  assert.deepEqual(mapboxLineFeatures(points)[0].geometry.coordinates, [[-75, 40], [-75.2, 40.8], [-74, 41]]);
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

test('actual pickup/delivery stops retain their identity and exclude unknown coordinates', () => {
  const stops = validMapStops([
    { sequence: 1, role: 'pickup', latitude: '42.7', longitude: '-71.1' },
    { sequence: 2, role: 'delivery', latitude: null, longitude: null },
    { sequence: 3, role: 'delivery', latitude: 40.6, longitude: -75.4 },
    { sequence: 4, latitude: 200, longitude: -75 },
  ]);
  assert.deepEqual(stops.map(stop => [stop.sequence, stop.lat, stop.lng]), [[1, 42.7, -71.1], [3, 40.6, -75.4]]);
  assert.deepEqual(validMapStops(), []);
});

test('fleet camera closely frames pickup and delivery, excluding a distant driver and GPS outlier', () => {
  const stops = validMapStops([
    { role: 'pickup', latitude: 43.3, longitude: -77.8 },
    { role: 'delivery', latitude: 40.8, longitude: -75.3 },
  ]);
  const focus = mapboxFocusPoints({ fitToStops: true, stops,
    path: [{ lat: 40, lng: -120 }], deadheadPath: [{ lat: 30, lng: -100 }],
    live: { lat: 39.6, lng: 66.9 } });
  assert.deepEqual(focus, stops);
  assert.deepEqual(mapboxFocusPoints({ fitToStops: true, stops, live: { lat: 0, lng: 0 } }), focus);
});

test('fleet camera includes every pickup and delivery, including intermediate stops', () => {
  const stops = validMapStops([
    { role: 'pickup', sequence: 1, latitude: 40, longitude: -75 },
    { role: 'pickup', sequence: 2, latitude: 42, longitude: -80 },
    { role: 'delivery', sequence: 3, latitude: 39, longitude: -72 },
    { role: 'delivery', sequence: 4, latitude: 41, longitude: -74 },
  ]);
  assert.deepEqual(mapboxFocusPoints({ fitToStops: true, stops }).map(stop => stop.sequence), [1, 2, 3, 4]);
});

test('without located stops fleet camera falls back to its track, not a far-away live position', () => {
  const path = [{ lat: 40, lng: -75 }, { lat: 41, lng: -74 }];
  assert.deepEqual(mapboxFocusPoints({ fitToStops: true, path, live: { lat: 0, lng: 0 } }), path);
  assert.deepEqual(mapboxFocusPoints({ fitToStops: true, live: { lat: 0, lng: 0 } }), []);
});

test('import preview retains whole route, deadhead and driver framing', () => {
  const path = [{ lat: 40, lng: -75 }], deadheadPath = [{ lat: 41, lng: -74 }];
  const stops = [{ lat: 42, lng: -73 }], live = { lat: 43, lng: -72 };
  assert.deepEqual(mapboxFocusPoints({ path, deadheadPath, stops, live }), [...path, ...deadheadPath, ...stops, live]);
});

test('resetting the fit when the map is hidden re-centers the same route on re-entry', () => {
  const routeKey = 'driver-a:load-a';
  assert.equal(shouldFitMapbox({ routeKey, hasRoute: true }, routeKey, true), false);
  assert.equal(shouldFitMapbox(null, routeKey, true), true);
});
