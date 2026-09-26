import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalSearchResults, normalizeSearchText } from './globalSearch.js';

const drivers = [{
  id: 'driver-1',
  name: 'Amin Karimov',
  driverNumber: '#B0B7',
  phone: '+998 97 910 50 60',
  currentLocation: 'Toshkent',
  truck: 'Volvo VNL',
}];

const loads = [{
  id: 'load-1',
  loadNumber: '#38495207',
  broker: 'TQL',
  origin: { city: 'Ephrata', state: 'PA' },
  destination: { city: 'Mechanicsburg', state: 'PA' },
  equipment: 'Reefer',
  rate: 2500,
  distanceMiles: 57.72,
  status: 'IN_TRANSIT',
  driverId: 'driver-1',
  documents: { rateCon: 'https://example.com/rate.pdf' },
}];

test('normalizes punctuation and Uzbek apostrophes for forgiving queries', () => {
  assert.equal(normalizeSearchText("Bo‘lim #384"), 'bo lim 384');
  assert.equal(normalizeSearchText('Механиксберг, ПА'), 'механиксберг па');
});

test('finds drivers by name, phone, number, location, and truck', () => {
  for (const query of ['Amin', '979105060', 'B0B7', 'Toshkent', 'Volvo']) {
    assert.ok(buildGlobalSearchResults({ query, drivers, loads }).some((result) => result.id === 'driver:driver-1'));
  }
  assert.equal(buildGlobalSearchResults({ query: 'Amin Karimov', drivers, loads })[0]?.id, 'driver:driver-1');
});

test('finds loads by number, route, broker, status, document, and assigned driver', () => {
  for (const query of ['38495207', 'Ephrata PA', 'TQL', 'tranzitda', 'RateCon']) {
    assert.ok(buildGlobalSearchResults({ query, drivers, loads }).some((result) => result.id === 'load:load-1'));
  }
  assert.ok(buildGlobalSearchResults({ query: 'Amin', drivers, loads }).some((result) => result.id === 'load:load-1'));
});

test('finds application sections and returns no results for an empty query', () => {
  assert.equal(buildGlobalSearchResults({ query: 'hujjat', drivers, loads })[0]?.tab, 'docs');
  assert.deepEqual(buildGlobalSearchResults({ query: '   ', drivers, loads }), []);
});

test('finds multilingual names without stripping non-Latin letters', () => {
  const multilingualDrivers = [{ ...drivers[0], id: 'driver-2', name: 'Амин Каримов' }];
  assert.equal(
    buildGlobalSearchResults({ query: 'Каримов', drivers: multilingualDrivers, loads: [] })[0]?.id,
    'driver:driver-2',
  );
});
