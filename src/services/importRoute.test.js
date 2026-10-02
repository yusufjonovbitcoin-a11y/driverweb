import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImportRoute } from './importRoute.js';

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
