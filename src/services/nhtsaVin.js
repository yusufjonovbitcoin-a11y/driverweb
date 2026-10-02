const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function isCompleteVin(value) {
  return VIN_PATTERN.test(normalizeVin(value));
}

export async function retryVinLookup(lookup, { signal, attempts = 3, delayMs = 600 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new Error('VIN lookup cancelled');
    try {
      return await lookup();
    } catch (error) {
      if (signal?.aborted || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  return null;
}

function cleanText(value, maxLength = 80) {
  const text = String(value || '').trim();
  return text.length <= maxLength ? text : '';
}

function fuelTypeFor(record) {
  const electrification = String(record.ElectrificationLevel || '').toLowerCase();
  if (electrification.includes('hybrid')) return 'hybrid';

  const fuel = String(record.FuelTypePrimary || '').toLowerCase();
  if (fuel.includes('diesel')) return 'diesel';
  if (fuel.includes('gasoline') || fuel.includes('petrol')) return 'gasoline';
  if (fuel.includes('electric')) return 'electric';
  return null;
}

export function parseNhtsaVinResult(payload, vin, now = new Date()) {
  const normalizedVin = normalizeVin(vin);
  if (!isCompleteVin(normalizedVin)) return null;

  const record = payload?.Results?.[0];
  if (!record || normalizeVin(record.VIN) !== normalizedVin) return null;
  if (String(record.ErrorCode || '').trim() !== '0') return null;

  const year = Number(record.ModelYear);
  const modelYear = Number.isInteger(year) && year >= 1980 && year <= now.getFullYear() + 2
    ? String(year)
    : null;
  const make = cleanText(record.Make);
  const model = cleanText(record.Model);
  const fuelType = fuelTypeFor(record);

  if (!make && !model && !modelYear && !fuelType) return null;
  return { make, model, modelYear, fuelType };
}
