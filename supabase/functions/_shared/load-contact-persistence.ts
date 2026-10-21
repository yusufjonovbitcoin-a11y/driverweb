import type { StopRow, StopContactResult } from './load-contact-lookup.ts';

// Google Places permits durable Place IDs, not a copy of its phone content.
// Keep provider phones transient and preserve operator/document-owned phones.
export async function persistStopContact(client: any, loadId: string, stop: StopRow, result: StopContactResult) {
  if (stop.contact_place_id || !result.placeId) return;
  let query = client.from('load_stops').update({ contact_place_id: result.placeId })
    .eq('id', stop.id).eq('load_id', loadId).is('contact_place_id', null);
  for (const key of ['type', 'facility_name', 'address_line', 'city', 'region', 'postal_code'] as const) {
    query = stop[key] == null ? query.is(key, null) : query.eq(key, stop[key]);
  }
  const { error } = await query;
  if (error) {
    const failure = new Error('CONTACT_SAVE_FAILED') as Error & { code: string };
    // SQLSTATE alone is safe to log; database details may contain phone/address.
    failure.code = typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'CONTACT_SAVE_FAILED';
    throw failure;
  }
}
