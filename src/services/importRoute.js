// Mapbox estimates are display-only; they never overwrite document facts.
export async function fetchImportRoute(pickup, delivery, token, signal, fetcher = fetch) {
  if (!token || !pickup || !delivery) throw new Error('route_unavailable');
  async function request(url) {
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error('route_unavailable');
    return response.json();
  }
  async function locate(address) {
    const params = new URLSearchParams({ q: address, access_token: token, limit: '1', autocomplete: 'false', types: 'address' });
    const data = await request(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    const feature = data.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    // Do not draw a route to a weak or approximate address match.
    if (!['exact', 'high'].includes(feature?.properties?.match_code?.confidence)
      || !Array.isArray(coordinates) || coordinates.length < 2
      || !coordinates.every(Number.isFinite)
      || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) throw new Error('route_unavailable');
    return coordinates.slice(0, 2);
  }
  const [start, end] = await Promise.all([locate(pickup), locate(delivery)]);
  const params = new URLSearchParams({ access_token: token, geometries: 'geojson', overview: 'full' });
  const data = await request(`https://api.mapbox.com/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}?${params}`);
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || route?.geometry?.type !== 'LineString'
    || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2
    || !route.geometry.coordinates.every(point => Array.isArray(point) && point.length >= 2
      && point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) throw new Error('route_unavailable');
  return { points: route.geometry.coordinates.map(([longitude, latitude]) => ({ longitude, latitude })) };
}

// Read-only preview routing. Addresses are geocoded and routed in the printed
// stop order; this never creates a load or changes document-extracted miles.
export async function fetchImportPreviewRoute(addresses, token, driver, signal, fetcher = fetch) {
  if (!token || !Array.isArray(addresses) || addresses.length < 2 || addresses.length > 25
    || addresses.some(address => typeof address !== 'string' || !address.trim())) {
    throw new Error('route_unavailable');
  }
  async function request(url) {
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error('route_unavailable');
    return response.json();
  }
  async function locate(address) {
    const params = new URLSearchParams({ q: address, access_token: token, limit: '1', autocomplete: 'false', types: 'address' });
    const data = await request(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    const feature = data.features?.[0];
    const point = feature?.geometry?.coordinates;
    if (!['exact', 'high'].includes(feature?.properties?.match_code?.confidence)
      || !Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('route_unavailable');
    return point.slice(0, 2);
  }
  async function leg(start, end) {
    const params = new URLSearchParams({ access_token: token, geometries: 'geojson', overview: 'full' });
    const data = await request(`https://api.mapbox.com/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}?${params}`);
    const route = data.routes?.[0];
    const points = route?.geometry?.coordinates;
    if (data.code !== 'Ok' || route?.geometry?.type !== 'LineString'
      || !Array.isArray(points) || points.length < 2
      || !points.every(point => Array.isArray(point) && point.length >= 2
        && point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
      || !Number.isFinite(route.distance) || route.distance < 0) throw new Error('route_unavailable');
    return { meters: route.distance, points: points.map(([longitude, latitude]) => ({ longitude, latitude })) };
  }
  const locations = await Promise.all(addresses.map(locate));
  const legs = await Promise.all(locations.slice(1).map((end, index) => leg(locations[index], end)));
  const loadedMeters = legs.reduce((total, item) => total + item.meters, 0);
  const loadedMiles = Math.round(loadedMeters / 1609.344 * 100) / 100;
  const points = legs.flatMap((item, index) => index ? item.points.slice(1) : item.points);
  const targets = [];
  if (driver?.id) {
    const position = driver.position;
    const validPosition = position && Number.isFinite(position.lat) && Number.isFinite(position.lng)
      && Math.abs(position.lat) <= 90 && Math.abs(position.lng) <= 180;
    if (!validPosition) {
      targets.push({ driverId: driver.id, status: 'gps_unavailable', deadheadMiles: null, totalMiles: null });
    } else {
      try {
        const deadhead = await leg([position.lng, position.lat], locations[0]);
        targets.push({ driverId: driver.id, status: 'ready', deadheadMiles: Math.round(deadhead.meters / 1609.344 * 100) / 100,
          totalMiles: Math.round((loadedMeters + deadhead.meters) / 1609.344 * 100) / 100,
          originLatitude: position.lat, originLongitude: position.lng, points: deadhead.points });
      } catch {
        targets.push({ driverId: driver.id, status: 'route_unavailable', deadheadMiles: null, totalMiles: null });
      }
    }
  }
  return { points, loadedMiles, targets, provider: 'mapbox', legs: legs.map((item, index) => ({
    from: index + 1, to: index + 2, distanceMiles: Math.round(item.meters / 1609.344 * 100) / 100,
  })) };
}
