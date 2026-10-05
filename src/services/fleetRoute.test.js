import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFleetRoute, fleetStopAddress } from './fleetRoute.js';

const reply = data => ({ ok: true, json: async () => data });
const geo = (coordinates, confidence = 'high') => ({ features: [{ geometry: { coordinates }, properties: { match_code: { confidence } } }] });
const stops = [
  { sequence: 1, role: 'pickup', markerLabel: 'P1', latitude: 42.7, longitude: -71.1 },
  { sequence: 2, role: 'pickup', markerLabel: 'P2', latitude: 41.5, longitude: -72.2 },
  { sequence: 3, role: 'delivery', markerLabel: 'D1', latitude: 40.6, longitude: -75.4 },
  { sequence: 4, role: 'delivery', markerLabel: 'D2', latitude: 40.8, longitude: -74 },
];
const roadReply = url => reply({ code: 'Ok', routes: [{ geometry: { type: 'LineString',
  coordinates: url.match(/driving\/([^?]+)/)[1].split(';').map(item => item.split(',').map(Number)) } }] });

test('active road route visits every pickup/delivery in source order without re-geocoding known coordinates', async () => {
  const calls = [], signal = new AbortController().signal;
  const original = structuredClone(stops);
  const result = await fetchFleetRoute(stops, 'test-token', { signal, fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.signal, signal); return roadReply(url);
  } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/driving/-71.1,42.7;-72.2,41.5;-75.4,40.6;-74,40.8?'));
  assert.deepEqual(result.stops.map(stop => stop.markerLabel), ['P1', 'P2', 'D1', 'D2']);
  assert.equal(result.points.length, 4);
  assert.equal(result.routingFailed, false);
  assert.deepEqual(stops, original);
  assert.equal(result.distanceMiles, undefined);
});

test('routes longer than 25 stops overlap chunks without dropping or reordering a stop', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ sequence: i + 1, latitude: 40 + i / 100, longitude: -75 + i / 100 }));
  const calls = [];
  const result = await fetchFleetRoute(many, 'test-token', { fetcher: async url => { calls.push(url); return roadReply(url); } });
  assert.equal(calls.length, 2);
  const paths = calls.map(url => url.match(/driving\/([^?]+)/)[1].split(';'));
  assert.equal(paths[0].length, 25);
  assert.equal(paths[1].length, 6);
  assert.equal(paths[0].at(-1), paths[1][0]);
  assert.deepEqual(result.points, many.map(stop => ({ latitude: stop.latitude, longitude: stop.longitude })));
});

test('marker-only mode never requests Directions or returns an invented GPS line', async () => {
  const result = await fetchFleetRoute(stops, 'test-token', { roadRoute: false,
    fetcher: async () => { assert.fail('Known completed stops need no external requests'); } });
  assert.equal(result.points.length, 0);
  assert.equal(result.stops.length, 4);
  assert.equal(result.routingFailed, false);
});

test('completed load can still display the pickup/delivery road route without GPS history', async () => {
  const result = await fetchFleetRoute(stops, 'test-token', { roadRoute: true, fetcher: async url => roadReply(url) });
  assert.deepEqual(result.points, stops.map(stop => ({ latitude: stop.latitude, longitude: stop.longitude })));
  assert.equal(result.routingFailed, false);
  assert.equal(result.recordedPoints, undefined);
});

test('unknown stops are geocoded once per request and only address/location data is sent', async () => {
  const calls = [];
  const address = { address: '123 Test Street', city: 'Test City', state: 'NY', postalCode: '12345',
    contactPhone: '555-555-5555', facility: 'Private facility name', document: 'Private PDF contents' };
  const result = await fetchFleetRoute([
    { ...address, sequence: 1, role: 'pickup' }, { ...address, sequence: 2, role: 'pickup' }, stops[3],
  ], 'test-token', { fetcher: async url => {
    calls.push(url);
    return url.includes('/forward?') ? reply(geo([-73, 41])) : roadReply(url);
  } });
  assert.equal(calls.filter(url => url.includes('/forward?')).length, 1);
  assert.equal(result.stops[0].latitude, 41);
  assert.deepEqual(result.unlocated, []);
  for (const url of calls) {
    assert.ok(!url.includes('555-555'));
    assert.ok(!url.includes('Private'));
  }
});

test('weak geocoding preserves known markers, identifies the missing stop, and never skips it in the road route', async () => {
  let directions = 0;
  const result = await fetchFleetRoute([stops[0], { sequence: 2, address: '123 Test Road' }, stops[2]], 'test-token', {
    fetcher: async url => {
      if (url.includes('/driving/')) directions++;
      return reply(geo([-73, 41], 'low'));
    },
  });
  assert.equal(directions, 0);
  assert.deepEqual(result.unlocated, [2]);
  assert.equal(result.stops[0].latitude, stops[0].latitude);
  assert.equal(result.stops[1].latitude, null);
  assert.equal(result.routingFailed, true);
  assert.deepEqual(result.points, []);
});

test('city-only stops are not pinned to a city centroid as if they were a loading dock', async () => {
  assert.equal(fleetStopAddress({ address: 'Flanders, NJ', city: 'Flanders', state: 'NJ' }), null);
  assert.equal(fleetStopAddress({ city: 'Flanders', state: 'NJ' }), null);
  const result = await fetchFleetRoute([stops[0], { sequence: 2, city: 'Flanders', state: 'NJ' }], 'test-token', {
    fetcher: async () => { assert.fail('An incomplete stop cannot be silently skipped/geocoded'); },
  });
  assert.deepEqual(result.unlocated, [2]);
});

test('NoRoute, malformed geometry and HTTP errors never generate a straight-line substitute', async () => {
  for (const response of [reply({ code: 'NoRoute', routes: [] }),
    reply({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[999, 40], [-75, 41]] } }] }),
    { ok: false },
  ]) {
    const result = await fetchFleetRoute(stops, 'test-token', { fetcher: async () => response });
    assert.equal(result.stops.length, 4);
    assert.equal(result.routingFailed, true);
    assert.deepEqual(result.points, []);
  }
});

test('aborted requests cannot return stale geometry and missing tokens do not send requests', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchFleetRoute(stops, 'test-token', { signal: controller.signal }), { name: 'AbortError' });
  const result = await fetchFleetRoute(stops, '', { fetcher: async () => { assert.fail('Missing API token'); } });
  assert.equal(result.routingFailed, true);
  assert.deepEqual(result.points, []);
});

test('a late response from a timed-out route is rejected even if its fetcher ignores cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(fetchFleetRoute(stops, 'test-token', {
    signal: controller.signal,
    fetcher: async url => { controller.abort(); return roadReply(url); },
  }), { name: 'AbortError' });
});
