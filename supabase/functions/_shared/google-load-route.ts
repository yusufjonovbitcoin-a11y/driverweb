import { decodePolyline, freshPosition, routeMetrics, matchesPlaceAddress } from './load-enrichment.ts';

async function locateWithMapbox(stop: any, token: string, fetcher: typeof fetch) {
  if (!stop.address_line || !stop.city || !stop.region) throw new Error(`${stop.type}: stop address is incomplete`);
  const query = new URLSearchParams({
    q: [stop.address_line, stop.city, stop.region, stop.postal_code, 'USA'].filter(Boolean).join(', '),
    access_token: token, country: 'us', types: 'address', autocomplete: 'false', limit: '5',
  });
  // Temporary geocodes are used for this calculation only, never persisted.
  const response = await fetcher(`https://api.mapbox.com/search/geocode/v6/forward?${query}`, { signal: AbortSignal.timeout(12_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Mapbox address service returned HTTP ${response.status}`);
  const expectedNumber = /^\d+[a-z]?/i.exec(stop.address_line)?.[0]?.toLowerCase();
  const matches = (data.features ?? []).filter((feature: any) => {
    const properties = feature.properties ?? {};
    const context = properties.context ?? {};
    const point = feature.geometry?.coordinates;
    return properties.feature_type === 'address' && feature.geometry?.type === 'Point'
      && ['exact', 'high'].includes(properties.match_code?.confidence)
      && properties.match_code?.street === 'matched'
      && expectedNumber && String(context.address?.address_number).toLowerCase() === expectedNumber
      && context.region?.region_code === String(stop.region).toUpperCase()
      && context.country?.country_code === 'US'
      && (stop.postal_code ? context.postcode?.name === String(stop.postal_code).slice(0, 5) : properties.match_code?.place === 'matched')
      && Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite)
      && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  });
  if (matches.length !== 1) throw new Error(`${stop.type}: exact stop address could not be verified with Mapbox`);
  const [longitude, latitude] = matches[0].geometry.coordinates;
  return { latitude, longitude };
}

async function locate(stop: any, apiKey: string, fetcher: typeof fetch) {
  if (!stop.address_line || !stop.city || !stop.region) throw new Error('Stop address is incomplete');
  const address = [stop.address_line, stop.city, stop.region, stop.postal_code, 'USA'].filter(Boolean).join(', ');
  const query = new URLSearchParams({ address, key: apiKey, components: 'country:US' });
  const response = await fetcher(`https://maps.googleapis.com/maps/api/geocode/json?${query}`, { signal: AbortSignal.timeout(12_000) });
  const data = await response.json();
  // Some installations only enable Places + Routes, not the separate Geocoding API.
  // Places is equally usable here only after an exact structured-address match.
  if (data.status === 'REQUEST_DENIED') {
    const placesResponse = await fetcher('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.addressComponents,places.location' },
      body: JSON.stringify({ textQuery: address, regionCode: 'US', maxResultCount: 5 }),
    });
    const places = await placesResponse.json();
    const matches = (places.places ?? []).filter((place: any) => matchesPlaceAddress(stop, place)
      && Number.isFinite(place.location?.latitude) && Number.isFinite(place.location?.longitude));
    if (!placesResponse.ok || matches.length !== 1) throw new Error('Exact stop address could not be verified with Google Places');
    return matches[0].location;
  }
  const result = data.results?.[0];
  const coords = result?.geometry?.location;
  const component = (type: string) => result?.address_components?.find((part: any) => part.types?.includes(type));
  const expectedNumber = /^\d+[a-z]?/i.exec(stop.address_line)?.[0];
  if (!response.ok || data.status !== 'OK' || !result || data.results.length !== 1 || result.partial_match
    || !matchesPlaceAddress(stop, { addressComponents: result.address_components?.map((part: any) => ({
      types: part.types, longText: part.long_name, shortText: part.short_name,
    })) })
    || !['ROOFTOP', 'RANGE_INTERPOLATED'].includes(result.geometry?.location_type)
    || !component('street_number') || !expectedNumber
    || component('street_number').long_name.toLowerCase() !== expectedNumber.toLowerCase()
    || component('administrative_area_level_1')?.short_name !== stop.region.toUpperCase()
    || (stop.postal_code && component('postal_code')?.long_name !== stop.postal_code.slice(0, 5))
    || !Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng)) {
    throw new Error(data.status === 'REQUEST_DENIED' ? 'Google Geocoding API is unavailable' : 'Exact stop address could not be verified');
  }
  return { latitude: coords.lat, longitude: coords.lng };
}

async function mapboxRoad(origin: any, destination: any, token: string, fetcher: typeof fetch) {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const query = new URLSearchParams({ access_token: token, geometries: 'polyline', overview: 'full', alternatives: 'false' });
  const response = await fetcher(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${query}`, { signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  const route = data.routes?.[0];
  if (!response.ok || data.code !== 'Ok' || !route) throw new Error('Road route is unavailable from Mapbox');
  const points = decodePolyline(route.geometry ?? '');
  if (points.length < 2) throw new Error('Route geometry is unavailable');
  return { ...routeMetrics({ distanceMeters: route.distance, duration: `${route.duration}s` }), points, provider: 'mapbox' };
}

async function road(origin: any, destination: any, apiKey: string, fetcher: typeof fetch, mapboxToken: string, provider = 'google_routes'): Promise<any> {
  if (provider === 'mapbox') return mapboxRoad(origin, destination, mapboxToken, fetcher);
  try {
  const response = await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
    body: JSON.stringify({ origin: { location: { latLng: origin } }, destination: { location: { latLng: destination } },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', units: 'IMPERIAL', polylineQuality: 'HIGH_QUALITY' }),
  });
  const data = await response.json();
  if (!response.ok || !data.routes?.[0]) throw new Error(`Google Routes: ${data.error?.status || response.status} ${data.error?.message || 'No route found'}`);
  const route = data.routes[0];
  const points = decodePolyline(route.polyline?.encodedPolyline ?? '');
  if (points.length < 2) throw new Error('Route geometry is unavailable');
  return { ...routeMetrics(route), points, provider: 'google_routes' };
  } catch (error) {
    if (!mapboxToken) throw error;
    return { ...await mapboxRoad(origin, destination, mapboxToken, fetcher), fallback: true,
      fallbackReason: error instanceof Error ? error.message : 'Google Routes unavailable' };
  }
}

export async function previewLoadRoute(stops: any[], presence: any[], driverIds: string[], apiKey: string,
  fetcher: typeof fetch = fetch, now = Date.now(), mapboxToken = '', preferredProvider = 'google_routes') {
  if (preferredProvider === 'mapbox' ? !mapboxToken : !apiKey) throw new Error(`${preferredProvider === 'mapbox' ? 'Mapbox' : 'Google Routes'} key is not configured`);
  if (stops.length < 2 || stops.length > 25 || stops[0].type !== 'pickup' || stops.at(-1).type !== 'delivery'
    || stops.some(stop => !['pickup', 'delivery'].includes(stop.type))) {
    throw new Error('Route requires 2–25 ordered pickup/delivery stops');
  }
  const locations = await Promise.all(stops.map(stop => preferredProvider === 'mapbox'
    ? locateWithMapbox(stop, mapboxToken, fetcher) : locate(stop, apiKey, fetcher)));
  const pickup = locations[0], delivery = locations.at(-1);
  const legs = await Promise.all(locations.slice(1).map((destination, i) => road(locations[i], destination, apiKey, fetcher, mapboxToken, preferredProvider)));
  if (new Set(legs.map(leg => leg.provider)).size !== 1) throw Error('Route providers differ between stops');
  const meters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
  const loaded = { ...legs[0], distanceMeters: meters, distanceMiles: Math.round(meters / 1609.344 * 100) / 100,
    durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0), points: legs.flatMap((leg, i) => i ? leg.points.slice(1) : leg.points) };
  const targets = await Promise.all(driverIds.map(async driverId => {
      const row = presence.find(item => item.driver_id === driverId);
      const origin = freshPosition(row, now);
      if (!origin) return { driverId, deadheadMiles: null, deadheadMeters: null, hasCurrentLocation: false, status: 'gps_unavailable' };
      try {
        // Keep both legs on the displayed provider. A failed Google deadhead
        // must not silently mix a Mapbox leg into a Google-labelled total.
        const result = await road(origin, pickup, apiKey, fetcher,
          loaded.provider === 'mapbox' ? mapboxToken : '', loaded.provider);
        return { driverId, deadheadMiles: result.distanceMiles, deadheadMeters: result.distanceMeters,
          durationSeconds: result.durationSeconds, points: result.points, hasCurrentLocation: true,
          originLatitude: origin.latitude, originLongitude: origin.longitude, locationAt: row.last_seen_at, status: 'ready' };
      } catch {
        return { driverId, deadheadMiles: null, deadheadMeters: null, hasCurrentLocation: true, status: 'route_unavailable' };
      }
    }));
  return { loadedMiles: loaded.distanceMiles, loadedMeters: loaded.distanceMeters, durationSeconds: loaded.durationSeconds,
    points: loaded.points, pickup, delivery,
    stops: locations.map((location, i) => ({ ...location, role: stops[i].type, sequence: i + 1 })),
    legs: legs.map((leg, i) => ({ from: i + 1, to: i + 2, distanceMiles: leg.distanceMiles, durationSeconds: leg.durationSeconds })),
    targets: targets.map(target => ({ ...target,
      totalMiles: target.deadheadMeters == null ? null : Math.round((loaded.distanceMeters + target.deadheadMeters) / 1609.344 * 100) / 100 })),
    provider: loaded.provider, usedFallback: loaded.fallback === true, fallbackReason: loaded.fallbackReason,
    calculatedAt: new Date(now).toISOString(), vehicleMode: 'DRIVE' };
}
