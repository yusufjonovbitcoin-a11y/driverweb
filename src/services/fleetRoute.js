// Display-only Mapbox results. Never write geocoded stops or road estimates to
// the load/document, or substitute them for a completed trip's GPS trace.
function validCoordinate(latitude, longitude) {
  return latitude !== null && latitude !== undefined && latitude !== ''
    && longitude !== null && longitude !== undefined && longitude !== ''
    && Number.isFinite(Number(latitude)) && Math.abs(Number(latitude)) <= 90
    && Number.isFinite(Number(longitude)) && Math.abs(Number(longitude)) <= 180;
}

export function fleetStopAddress(stop) {
  const street = typeof stop?.address === 'string' ? stop.address.trim() : '';
  const locality = [stop?.city, stop?.state].filter(Boolean).join(', ');
  // A city centroid is not a loading dock. Do not invent an exact location.
  if (!street || street.toLowerCase() === locality.toLowerCase()) return null;
  return [street, stop?.city, stop?.state, stop?.postalCode].filter(Boolean).join(', ');
}

export async function fetchFleetRoute(stops, token, { roadRoute = true, signal, fetcher = fetch } = {}) {
  if (!Array.isArray(stops)) throw new Error('route_unavailable');
  signal?.throwIfAborted();
  async function request(url) {
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error('route_unavailable');
    return response.json();
  }
  const requests = new Map();
  async function locate(stop) {
    if (validCoordinate(stop.latitude, stop.longitude)) {
      return { ...stop, latitude: Number(stop.latitude), longitude: Number(stop.longitude) };
    }
    const address = fleetStopAddress(stop);
    if (!token || !address) return { ...stop, latitude: null, longitude: null };
    // Deduplicate within this displayed request only, not a persistent cache
    // of temporary geocoding results.
    if (!requests.has(address)) {
      const params = new URLSearchParams({ q: address, access_token: token, limit: '1', autocomplete: 'false', types: 'address' });
      requests.set(address, request(`https://api.mapbox.com/search/geocode/v6/forward?${params}`).then(data => {
        const feature = data.features?.[0];
        const coordinates = feature?.geometry?.coordinates;
        if (!['exact', 'high'].includes(feature?.properties?.match_code?.confidence)
          || !Array.isArray(coordinates) || !validCoordinate(coordinates[1], coordinates[0])) throw new Error('route_unavailable');
        return coordinates;
      }));
    }
    try {
      const coordinates = await requests.get(address);
      return { ...stop, latitude: Number(coordinates[1]), longitude: Number(coordinates[0]) };
    } catch {
      signal?.throwIfAborted();
      return { ...stop, latitude: null, longitude: null };
    }
  }
  const located = await Promise.all(stops.map(locate));
  signal?.throwIfAborted();
  const unlocated = located.filter(stop => !validCoordinate(stop.latitude, stop.longitude)).map(stop => stop.sequence);
  const result = { stops: located, points: [], unlocated, routingFailed: false };
  // Marker-only mode is optional. A planned road route can also be displayed
  // for a completed trip, separately from its actual recorded GPS trace.
  if (!roadRoute) return result;
  if (!token || located.length < 2 || unlocated.length) return { ...result, routingFailed: true };
  try {
    // Directions accepts 25 waypoints per request. Overlap the endpoint so
    // larger loads retain every pickup/delivery in the document order.
    const chunks = [];
    for (let start = 0; start < located.length - 1; start += 24) {
      const waypoints = located.slice(start, start + 25).map(stop => `${stop.longitude},${stop.latitude}`).join(';');
      const params = new URLSearchParams({ access_token: token, geometries: 'geojson', overview: 'full' });
      chunks.push(request(`https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?${params}`).then(data => {
        const route = data.routes?.[0];
        const coordinates = route?.geometry?.coordinates;
        if (data.code !== 'Ok' || route?.geometry?.type !== 'LineString'
          || !Array.isArray(coordinates) || coordinates.length < 2
          || !coordinates.every(point => Array.isArray(point) && validCoordinate(point[1], point[0]))) throw new Error('route_unavailable');
        return coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
      }));
    }
    const legs = await Promise.all(chunks);
    signal?.throwIfAborted();
    return { ...result, points: legs.flatMap((leg, index) => index ? leg.slice(1) : leg) };
  } catch {
    signal?.throwIfAborted();
    return { ...result, routingFailed: true };
  }
}
