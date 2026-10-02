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
