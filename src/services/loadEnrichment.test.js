import test from 'node:test';
import assert from 'node:assert/strict';
import { validPhone, phoneUri, freshPosition, matchesPlaceAddress, routeMetrics, decodePolyline } from '../../supabase/functions/_shared/load-enrichment.ts';
import { previewLoadRoute } from '../../supabase/functions/_shared/google-load-route.ts';

const now = Date.parse('2026-10-02T12:00:00Z');
const stops = [
  { type: 'pickup', address_line: '1023 Buffalo Run', city: 'Missouri City', region: 'TX', postal_code: '77489' },
  { type: 'delivery', address_line: '445 Birch Street', city: 'Lake Elsinore', region: 'CA', postal_code: '92530' },
];
const presence = { driver_id: 'driver', is_online: true, latitude: 29, longitude: -95, last_seen_at: new Date(now).toISOString(), location_captured_at: new Date(now).toISOString() };
function mockMapbox({ confidence = 'exact', postalMismatch = false, ambiguous = false, failDeadhead = false } = {}) {
  let roads = 0;
  const fetcher = async url => {
    assert.ok(url.startsWith('https://api.mapbox.com/'), 'Mapbox mode must never require Google');
    if (url.includes('/search/geocode/')) {
      const address = new URL(url).searchParams.get('q');
      const stop = stops.find(s => address.includes(s.address_line));
      const feature = { geometry: { type: 'Point', coordinates: [-95, stop.type === 'pickup' ? 30 : 33] }, properties: {
        feature_type: 'address', match_code: { confidence, street: 'matched', place: 'matched' },
        context: { address: { address_number: stop.address_line.split(' ')[0] },
          region: { region_code: stop.region }, country: { country_code: 'US' }, postcode: { name: postalMismatch ? '00000' : stop.postal_code } },
      } };
      return Response.json({ features: ambiguous ? [feature, feature] : [feature] });
    }
    roads++;
    const deadhead = url.includes('/-95,29;');
    if (deadhead && failDeadhead) return Response.json({ code: 'NoRoute' });
    return Response.json({ code: 'Ok', routes: [{ distance: deadhead ? 160934.4 : 1609344, duration: 3600, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }] });
  };
  return { fetcher, roads: () => roads };
}

test('Mapbox primary verifies addresses and calculates both road legs without a Google key', async () => {
  const mock = mockMapbox();
  const result = await previewLoadRoute(stops, [presence], ['driver'], '', mock.fetcher, now, 'pk.test', 'mapbox');
  assert.equal(result.provider, 'mapbox');
  assert.equal(result.usedFallback, false);
  assert.equal(result.loadedMiles, 1000);
  assert.equal(result.targets[0].deadheadMiles, 100);
  assert.equal(result.targets[0].totalMiles, 1100);
  assert.equal(mock.roads(), 2);
});
test('Mapbox rejects uncertain, wrong-ZIP and ambiguous addresses before calculating', async () => {
  for (const config of [{ confidence: 'medium' }, { postalMismatch: true }, { ambiguous: true }]) {
    const mock = mockMapbox(config);
    await assert.rejects(previewLoadRoute(stops, [], [], '', mock.fetcher, now, 'pk.test', 'mapbox'), /verified with Mapbox/);
    assert.equal(mock.roads(), 0);
  }
});
test('Mapbox retains pickup-delivery miles even if driver is offline or deadhead fails', async () => {
  for (const failDeadhead of [false, true]) {
    const mock = mockMapbox({ failDeadhead });
    const result = await previewLoadRoute(stops, [{ ...presence, is_online: failDeadhead }], ['driver'], '', mock.fetcher, now, 'pk.test', 'mapbox');
    assert.equal(result.loadedMiles, 1000);
    assert.equal(result.targets[0].totalMiles, null);
    assert.equal(result.targets[0].status, failDeadhead ? 'route_unavailable' : 'gps_unavailable');
  }
});
test('Mapbox mode reports a missing token rather than silently calling another provider', async () => {
  await assert.rejects(previewLoadRoute(stops, [], [], 'google', () => { throw Error('must not call'); }, now, '', 'mapbox'), /Mapbox key/);
});
function components(stop) {
  const [number, ...street] = stop.address_line.split(' ');
  return [['street_number', number], ['route', street.join(' ')], ['locality', stop.city], ['administrative_area_level_1', stop.region], ['postal_code', stop.postal_code], ['country', 'US']]
    .map(([type, value]) => ({ types: [type], longText: value, shortText: value }));
}
function mockGoogle({ failDeadhead = false, partial = false, wrongStreet = false } = {}) {
  let routes = 0;
  const fetcher = async (url, options) => {
    if (url.includes('/geocode/')) {
      const stop = stops.find(item => url.includes(encodeURIComponent(item.address_line).replaceAll('%20', '+')));
      const parts = components(stop).map(part => ({ types: part.types, long_name: part.longText, short_name: part.shortText }));
      if (wrongStreet) parts.find(part => part.types.includes('route')).long_name = 'Wrong Street';
      return Response.json({ status: 'OK', results: [{ partial_match: partial, address_components: parts,
        geometry: { location_type: 'ROOFTOP', location: { lat: stop.type === 'pickup' ? 30 : 33, lng: -95 } } }] });
    }
    routes++;
    const body = JSON.parse(options.body);
    assert.equal(body.travelMode, 'DRIVE');
    const deadhead = body.origin.location.latLng.latitude === 29;
    if (deadhead && failDeadhead) return Response.json({ error: 'No route' }, { status: 503 });
    return Response.json({ routes: [{ distanceMeters: deadhead ? 160934.4 : 1609344, duration: '3600s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] });
  };
  return { fetcher, routes: () => routes };
}
test('CONTACT blobs and invalid numbers cannot become phone links', () => {
  for (const value of ['/NCFISPHO1023BUFFAMISSOURICTX77489CONTACT', '/Dalinghaus445BirchLakeElsinCa92530CONTACT', '0800-1500', '', null]) assert.equal(validPhone(value), null);
  assert.equal(validPhone('913-904-5165'), '913-904-5165');
  assert.equal(phoneUri('+1 937-684-8171 Ext: 8171'), 'tel:+19376848171;ext=8171');
  assert.equal(phoneUri('+1 937-684-8171 Ext. 8171'), 'tel:+19376848171;ext=8171');
});
test('GPS must be fresh, online and valid; zero coordinates are not missing', () => {
  assert.deepEqual(freshPosition({ ...presence, latitude: 0, longitude: 0 }, now), { latitude: 0, longitude: 0 });
  for (const override of [{ is_online: false }, { latitude: null }, { latitude: 91 }, { last_seen_at: 'bad' }, { last_seen_at: new Date(now - 120001).toISOString() }, { last_seen_at: new Date(now + 60000).toISOString() }]) assert.equal(freshPosition({ ...presence, ...override }, now), null);
});
test('contact address requires street, number, state and ZIP, not loose text similarity', () => {
  const place = { addressComponents: components(stops[1]) };
  assert.equal(matchesPlaceAddress({ ...stops[1], address_line: '445 Birch St' }, place), true);
  for (const override of [{ address_line: '446 Birch Street' }, { address_line: '445 Main Street' }, { postal_code: '92531' }, { region: 'TX' }]) assert.equal(matchesPlaceAddress({ ...stops[1], ...override }, place), false);
});
test('meters convert to miles, zero stays zero, invalid results are rejected', () => {
  assert.equal(routeMetrics({ distanceMeters: 1609.344, duration: '61.2s' }).distanceMiles, 1);
  assert.equal(routeMetrics({ distanceMeters: 0, duration: '0s' }).distanceMiles, 0);
  for (const route of [{}, { distanceMeters: -1, duration: '2s' }, { distanceMeters: 1, duration: 'bad' }]) assert.throws(() => routeMetrics(route));
  assert.equal(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@').length, 3);
  assert.throws(() => decodePolyline('_'));
});
test('both road legs use Google and total sums exact meters before rounding', async () => {
  const mock = mockGoogle();
  const result = await previewLoadRoute(stops, [presence], ['driver'], 'test', mock.fetcher, now);
  assert.equal(result.loadedMiles, 1000);
  assert.equal(result.targets[0].deadheadMiles, 100);
  assert.equal(result.targets[0].totalMiles, 1100);
  assert.equal(result.targets[0].status, 'ready');
  assert.equal(mock.routes(), 2);
  assert.equal(result.provider, 'google_routes');
});
test('unavailable GPS/failed road route never become fabricated zero miles', async () => {
  for (const fail of [false, true]) {
    const mock = mockGoogle({ failDeadhead: fail });
    const result = await previewLoadRoute(stops, fail ? [presence] : [], ['driver'], 'test', mock.fetcher, now);
    assert.equal(result.loadedMiles, 1000);
    assert.equal(result.targets[0].deadheadMiles, null);
    assert.equal(result.targets[0].totalMiles, null);
    assert.equal(result.targets[0].status, fail ? 'route_unavailable' : 'gps_unavailable');
  }
});
test('partial or wrong-street geocodes fail closed; no straight-line fallback', async () => {
  for (const config of [{ partial: true }, { wrongStreet: true }]) {
    const mock = mockGoogle(config);
    await assert.rejects(previewLoadRoute(stops, [], [], 'test', mock.fetcher, now), /verified/);
    assert.equal(mock.routes(), 0);
  }
});
test('a failed Google deadhead never silently mixes providers in the total', async () => {
  const mock = mockGoogle({ failDeadhead: true });
  const result = await previewLoadRoute(stops, [presence], ['driver'], 'test', mock.fetcher, now, 'pk.test');
  assert.equal(result.provider, 'google_routes');
  assert.equal(result.targets[0].status, 'route_unavailable');
  assert.equal(result.targets[0].totalMiles, null);
  assert.equal(mock.routes(), 2);
});
test('Places verifies coordinates when Geocoding is disabled, with ambiguous matches rejected', async () => {
  for (const ambiguous of [false, true]) {
    const base = mockGoogle();
    const fetcher = async (url, options) => {
      if (url.includes('/geocode/')) return Response.json({ status: 'REQUEST_DENIED' });
      if (url.includes('places:searchText')) {
        const stop = stops.find(item => JSON.parse(options.body).textQuery.includes(item.address_line));
        const place = { addressComponents: components(stop), location: { latitude: 30, longitude: -95 } };
        return Response.json({ places: ambiguous ? [place, place] : [place] });
      }
      return base.fetcher(url, options);
    };
    if (ambiguous) await assert.rejects(previewLoadRoute(stops, [], [], 'test', fetcher, now), /verified/);
    else assert.equal((await previewLoadRoute(stops, [], [], 'test', fetcher, now)).loadedMiles, 1000);
  }
});
test('Google failure uses real Mapbox road geometry for both legs with explicit provider', async () => {
  const base = mockGoogle();
  let googleCalls = 0, mapboxCalls = 0;
  const fetcher = async (url, options) => {
    if (url.includes('routes.googleapis.com')) { googleCalls++; return Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 }); }
    if (url.includes('api.mapbox.com/directions')) {
      mapboxCalls++;
      return Response.json({ code: 'Ok', routes: [{ distance: 1609.344, duration: 60, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }] });
    }
    return base.fetcher(url, options);
  };
  const route = await previewLoadRoute(stops, [presence], ['driver'], 'test', fetcher, now, 'pk.test');
  assert.equal(route.provider, 'mapbox');
  assert.equal(route.usedFallback, true);
  assert.equal(route.targets[0].totalMiles, 2);
  assert.equal(googleCalls, 1);
  assert.equal(mapboxCalls, 2);
});

test('route and pay origins require actual fresh GPS capture, not just heartbeat', () => {
  for (const capturedAt of [undefined, null, 'bad', new Date(now - 120_000).toISOString(), new Date(now + 30_001).toISOString()]) {
    assert.equal(freshPosition({ ...presence, location_captured_at: capturedAt }, now), null);
  }
});
