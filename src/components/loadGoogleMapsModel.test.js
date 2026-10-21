import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGoogleMapsRoutes } from './loadGoogleMapsModel.js';

const stop = (number, extra = {}) => ({ markerLabel: `P${number}`, address: `${number} Main Street`, city: 'Hilton', state: 'NY', postalCode: '14468', ...extra });
const stopsInLink = url => {
  const params = new URL(url).searchParams;
  return [params.get('origin'), ...(params.get('waypoints')?.split('|') || []), params.get('destination')];
};

test('one Google Maps link retains every pickup/delivery in the supplied order', () => {
  const stops = [stop(1), stop(2), stop(3, { markerLabel: 'D1' }), stop(4, { markerLabel: 'D2' })];
  const before = structuredClone(stops);
  const routes = loadGoogleMapsRoutes(stops);
  assert.equal(routes.length, 1);
  const url = new URL(routes[0].url);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.deepEqual(stopsInLink(url), stops.map(item => `${item.address}, ${item.city}, ${item.state}, ${item.postalCode}`));
  assert.deepEqual(stops, before);
});

test('known coordinates can route without an address, including zero coordinates', () => {
  const routes = loadGoogleMapsRoutes([{ latitude: 0, longitude: 0 }, { latitude: '40.5', longitude: '-75.1' }]);
  assert.deepEqual(stopsInLink(routes[0].url), ['0,0', '40.5,-75.1']);
});

test('many stops split into mobile-safe links with shared endpoints and no omissions', () => {
  const stops = Array.from({ length: 14 }, (_, index) => stop(index + 1));
  const routes = loadGoogleMapsRoutes(stops);
  assert.equal(routes.length, 4);
  const chains = routes.map(part => stopsInLink(part.url));
  for (const chain of chains) assert.ok(chain.length <= 5);
  for (let index = 1; index < chains.length; index++) assert.equal(chains[index][0], chains[index - 1].at(-1));
  assert.deepEqual(chains.flatMap((chain, index) => index ? chain.slice(1) : chain), stops.map(item => `${item.address}, ${item.city}, ${item.state}, ${item.postalCode}`));
  assert.equal(routes.at(-1).to, 'P14');
});

test('unknown middle stop never disappears into a misleading partial route', () => {
  assert.deepEqual(loadGoogleMapsRoutes([stop(1), { city: 'Unknown' }, stop(3)]), []);
  assert.deepEqual(loadGoogleMapsRoutes([stop(1)]), []);
  assert.deepEqual(loadGoogleMapsRoutes(null), []);
});

test('special characters are encoded and overlong URLs split without losing stops', () => {
  const stops = Array.from({ length: 6 }, (_, index) => stop(index + 1, { address: `${index} ${'Łę & #? '.repeat(18)}` }));
  const routes = loadGoogleMapsRoutes(stops);
  assert.ok(routes.length > 1);
  for (const route of routes) assert.ok(route.url.length <= 2048);
  assert.deepEqual(routes.flatMap((route, index) => index ? stopsInLink(route.url).slice(1) : stopsInLink(route.url)), stops.map(item => `${item.address.trim()}, Hilton, NY, 14468`));
  assert.deepEqual(loadGoogleMapsRoutes([stop(1, { address: 'a'.repeat(3000) }), stop(2)]), []);
});
