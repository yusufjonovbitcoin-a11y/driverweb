// Shared by document validation, contact lookup and the web view.
export function validPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const main = text.replace(/\s*(?:extension|ext\.?|x|#)\s*:?\s*\d+\s*$/i, '').trim();
  if (!/^\+?[\d\s().-]+$/.test(main)) return null;
  const digits = main.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? text : null;
}

export function phoneUri(value: unknown): string | null {
  const phone = validPhone(value);
  if (!phone) return null;
  const extension = /\s*(?:extension|ext\.?|x|#)\s*:?\s*(\d+)\s*$/i.exec(phone);
  const main = extension ? phone.slice(0, extension.index) : phone;
  return `tel:${main.replace(/[^+\d]/g, '')}${extension ? `;ext=${extension[1]}` : ''}`;
}

// A city-only document cannot identify a particular facility's phone number.
export function hasContactLookupAddress(stop: any): boolean {
  return Boolean(/^\d+[a-z]?\s+.*[a-z]/i.test(String(stop?.address_line ?? '').trim())
    && /^[a-z]{2}$/i.test(String(stop?.region ?? '').trim())
    && (String(stop?.city ?? '').trim() || /^\d{5}(?:-\d{4})?$/.test(String(stop?.postal_code ?? '').trim())));
}

export function freshPosition(row: any, now = Date.now()) {
  if (!row || row.is_online !== true || row.latitude == null || row.longitude == null) return null;
  const latitude = Number(row.latitude), longitude = Number(row.longitude);
  const age = now - Date.parse(row.last_seen_at);
  if (!Number.isFinite(age) || age < -30_000 || age > 120_000
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

const normalized = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const street = (value: unknown) => String(value ?? '').toLowerCase()
  .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\broad\b/g, 'rd')
  .replace(/\bdrive\b/g, 'dr').replace(/\bboulevard\b/g, 'blvd').replace(/\blane\b/g, 'ln')
  .replace(/\bsuite\b.*|\bste\b.*|#.*$/g, '').replace(/[^a-z0-9]/g, '');

export function matchesPlaceAddress(stop: any, place: any): boolean {
  const components = place.addressComponents ?? [];
  const component = (type: string) => components.find((part: any) => part.types?.includes(type));
  const number = component('street_number')?.longText;
  const route = component('route')?.longText;
  const region = component('administrative_area_level_1')?.shortText;
  const postal = component('postal_code')?.longText;
  const city = component('locality')?.longText ?? component('postal_town')?.longText;
  const country = component('country')?.shortText;
  return Boolean(number && route && region && country === 'US'
    && street(stop.address_line) === street(`${number} ${route}`)
    && normalized(stop.region) === normalized(region)
    && (stop.postal_code ? String(stop.postal_code).slice(0, 5) === String(postal).slice(0, 5)
      : normalized(stop.city) === normalized(city)));
}

export function routeMetrics(route: any) {
  const meters = route?.distanceMeters;
  const duration = /^([\d.]+)s$/.exec(String(route?.duration ?? ''));
  const seconds = duration ? Number(duration[1]) : NaN;
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0
    || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid road route');
  return { distanceMeters: meters, distanceMiles: Math.round(meters / 1609.344 * 100) / 100,
    durationSeconds: Math.round(seconds) };
}

export function decodePolyline(encoded: string) {
  let index = 0, lat = 0, lng = 0;
  const points: { latitude: number; longitude: number }[] = [];
  const read = () => {
    let shift = 0, result = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid route geometry');
      result |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += read(); lng += read();
    if (Math.abs(lat / 1e5) > 90 || Math.abs(lng / 1e5) > 180) throw new Error('Invalid route coordinates');
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}
