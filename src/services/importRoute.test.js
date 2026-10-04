import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImportRoute, fetchImportPreviewRoute } from './importRoute.js';

const geo = (coordinates, confidence = 'high') => ({ features: [{ geometry: { coordinates }, properties: { match_code: { confidence } } }] });
const reply = data => ({ ok: true, json: async () => data });
test('route uses geocoded addresses and road geometry, without producing document distance facts', async () => {
  const urls = [];
  const signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    urls.push(url); assert.equal(options.signal, signal);
    return reply(url.includes('directions') ? { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[-112, 33], [-115, 34], [-118, 34]] }, distance: 999 }] }
      : geo(url.includes('Pickup') ? [-112, 33] : [-118, 34]));
  };
  const route = await fetchImportRoute('Pickup', 'Delivery', 'test-token', signal, fetcher);
  assert.equal(urls.length, 3);
  assert.equal(route.points.length, 3);
  assert.equal(route.distanceMiles, undefined);
});
test('weak, missing or invalid geocoding never draws a fabricated route', async () => {
  for (const data of [geo([-112, 33], 'low'), geo([999, 33]), { features: [] }]) {
    await assert.rejects(fetchImportRoute('A', 'B', 'test', undefined, async () => reply(data)));
  }
  await assert.rejects(fetchImportRoute('A', 'B', '', undefined));
  await assert.rejects(fetchImportRoute('A', 'B', 'test', undefined, async () => ({ ok: false })));
});

test('unsaved preview routes every stop in order and computes miles without persisting a load', async () => {
  const calls = [];
  const locations = { A: [-112, 33], B: [-115, 34], C: [-118, 35] };
  const fetcher = async url => {
    calls.push(url);
    if (url.includes('/forward?')) return reply(geo(locations[new URL(url).searchParams.get('q')]));
    const path = url.match(/driving\/([^?]+)/)?.[1];
    const coordinates = path.split(';').map(point => point.split(',').map(Number));
    return reply({ code: 'Ok', routes: [{ distance: path.startsWith('-110,32') ? 804.672 : 1609.344,
      geometry: { type: 'LineString', coordinates } }] });
  };
  const result = await fetchImportPreviewRoute(['A', 'B', 'C'], 'token',
    { id: 'driver', position: { lat: 32, lng: -110 } }, undefined, fetcher);
  assert.equal(result.loadedMiles, 2);
  assert.equal(result.points.length, 3);
  assert.deepEqual(result.legs.map(item => item.distanceMiles), [1, 1]);
  assert.equal(result.targets[0].deadheadMiles, 0.5);
  assert.equal(result.targets[0].totalMiles, 2.5);
  assert.equal(calls.filter(url => url.includes('/forward?')).length, 3);
  assert.equal(calls.filter(url => url.includes('/driving/')).length, 3);
});

test('missing GPS keeps preview loaded miles but does not invent driver distance', async () => {
  const fetcher = async url => reply(url.includes('/forward?')
    ? geo(new URL(url).searchParams.get('q') === 'A' ? [-112, 33] : [-118, 35])
    : { code: 'Ok', routes: [{ distance: 3218.688, geometry: { type: 'LineString', coordinates: [[-112, 33], [-118, 35]] } }] });
  const result = await fetchImportPreviewRoute(['A', 'B'], 'token', { id: 'driver', position: null }, undefined, fetcher);
  assert.equal(result.loadedMiles, 2);
  assert.equal(result.targets[0].status, 'gps_unavailable');
  assert.equal(result.targets[0].totalMiles, null);
  await assert.rejects(fetchImportPreviewRoute(['A', 'B'], 'token', null, undefined,
    async () => reply(geo([-112, 33], 'low'))), /route_unavailable/);
});
