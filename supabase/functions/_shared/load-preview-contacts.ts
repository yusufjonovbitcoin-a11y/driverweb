import { validPhone } from './load-enrichment.ts';
import type { StopRow } from './load-contact-lookup.ts';

// Accept only server-verified extraction, never client-supplied stop addresses.
export function previewContactStops(extracted: any): StopRow[] {
  const stops = Array.isArray(extracted.stops) ? extracted.stops
    : [{ ...extracted.pickup, role: 'pickup' }, { ...extracted.delivery, role: 'delivery' }];
  if (stops.length < 2 || stops.length > 25
    || stops.some((stop: any) => !['pickup', 'delivery'].includes(stop.role))) {
    throw Error('PREVIEW_STOPS_INVALID');
  }
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  return stops.map((stop: any, index: number) => ({
    id: `preview-${index + 1}`, type: stop.role,
    facility_name: text(stop.facilityName) || null,
    address_line: text(stop.addressLine), city: text(stop.city), region: text(stop.region),
    postal_code: text(stop.postalCode) || null, contact_name: text(stop.contactName) || null,
    contact_phone: validPhone(stop.contactPhone), contact_source: 'broker_document', contact_place_id: null,
  }));
}
