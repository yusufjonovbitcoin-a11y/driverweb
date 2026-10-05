import test from 'node:test';
import assert from 'node:assert/strict';
import { canLookupImportedStop, importContactsRequest, importedStopContact, startImportContacts } from './importContacts.js';
import { findStopContact } from '../../supabase/functions/_shared/load-contact-lookup.ts';
import { previewContactStops } from '../../supabase/functions/_shared/load-preview-contacts.ts';
import { canAssignImportedLoad } from '../components/importedLoadModel.js';

const stop = { id: 'stop', type: 'delivery', facility_name: 'Americold',
  address_line: '7150 Ambassador Dr', city: 'Allentown', region: 'PA', postal_code: '18106',
  contact_name: null, contact_phone: null, contact_source: null, contact_place_id: null };
const place = { id: 'place', displayName: { text: 'Americold' },
  formattedAddress: '7150 Ambassador Dr, Allentown, PA 18106, USA', nationalPhoneNumber: '610-555-0123',
  addressComponents: [['street_number', '7150'], ['route', 'Ambassador Drive'], ['locality', 'Allentown'],
    ['administrative_area_level_1', 'PA'], ['postal_code', '18106'], ['country', 'US']]
    .map(([type, value]) => ({ types: [type], longText: value, shortText: value })) };
const uiStop = { role: 'delivery', sequence: 2, address: stop.address_line, city: stop.city,
  state: stop.region, postalCode: stop.postal_code };

test('preview lookup uses its signed ticket; a saved load uses only its id', () => {
  const previewTicket = { payload: 'signed payload', signature: 'signature' };
  assert.deepEqual(importContactsRequest(null, previewTicket), { key: 'preview:signature', previewTicket });
  assert.deepEqual(importContactsRequest('saved', previewTicket), { key: 'load:saved', loadId: 'saved' });
  assert.equal(importContactsRequest(null, null), null);
  assert.equal(importContactsRequest(null, { payload: 'unsigned' }), null);
});

test('city-only and empty stops do not initiate external lookups or show a loading state', async () => {
  for (const address of ['', 'Allentown, PA']) {
    const result = await findStopContact({ ...stop, address_line: address }, 'test',
      () => { throw Error('no facility street to verify'); });
    assert.equal(result.contact.status, 'not_found');
    assert.equal(canLookupImportedStop({ ...uiStop, address }), false);
    assert.equal(importedStopContact({ ...uiStop, address }, null, true).contactPending, false);
  }
});

test('verified preview mapping retains all stops and invalid phones stay absent', () => {
  const extracted = { stops: [
    { role: 'pickup', facilityName: 'Shipper', addressLine: '1 First Ave', city: 'Phoenix', region: 'AZ', contactPhone: '602-555-0001' },
    { role: 'delivery', addressLine: '2 Second Ave', city: 'Dallas', region: 'TX', contactPhone: 'Phone/contact unknown' },
    { role: 'delivery', facilityName: 'Americold', addressLine: stop.address_line, city: stop.city, region: stop.region },
  ] };
  const result = previewContactStops(extracted);
  assert.equal(result.length, 3);
  assert.equal(result[0].contact_phone, '602-555-0001');
  assert.equal(result[1].contact_phone, null);
  assert.equal(result[2].facility_name, 'Americold');
  assert.equal(result[2].address_line, '7150 Ambassador Dr');
  assert.throws(() => previewContactStops({ stops: [{ role: 'carrier' }] }), /INVALID/);
});

test('document phone wins without calling the external provider', async () => {
  const result = await findStopContact({ ...stop, contact_phone: '(610) 555-9999', contact_source: 'broker_document' }, 'test',
    () => { throw Error('must not query a phone already printed in the PDF'); });
  assert.equal(result.contact.phone, '(610) 555-9999');
  assert.equal(result.contact.source, 'broker_document');
});

test('lookup accepts only the matching facility address and a valid phone', async () => {
  let calls = 0;
  const result = await findStopContact(stop, 'test', async (url, options) => {
    calls++;
    assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
    assert.ok(JSON.parse(options.body).textQuery.includes(stop.address_line));
    return Response.json({ places: [place] });
  });
  assert.equal(calls, 1);
  assert.equal(result.contact.phone, '610-555-0123');
  assert.equal(result.contact.source, 'google_places');
  for (const candidate of [
    { ...place, nationalPhoneNumber: 'not a phone' },
    { ...place, displayName: { text: 'Unrelated company' } },
    { ...place, addressComponents: place.addressComponents.map(p => p.types.includes('postal_code') ? { ...p, longText: '18107' } : p) },
  ]) {
    const invalid = await findStopContact(stop, 'test', async () => Response.json({ places: [candidate] }));
    assert.equal(invalid.contact.status, 'not_found');
    assert.equal(invalid.contact.phone, null);
  }
});

test('ambiguous provider results are not presented as a facility phone', async () => {
  const result = await findStopContact(stop, 'test', async () => Response.json({ places: [place, { ...place, id: 'another' }] }));
  assert.equal(result.contact.status, 'not_found');
});

test('provider outage is local to contact enrichment', async () => {
  const result = await findStopContact(stop, 'test', async () => Response.json({}, { status: 503 }));
  assert.equal(result.contact.status, 'provider_error');
  assert.equal(result.contact.phone, null);
});

test('multiple deliveries are matched by sequence, never by role alone', () => {
  const state = { data: { contacts: [
    { role: 'delivery', sequence: 2, status: 'found', phone: '610-555-0002', source: 'google_places' },
    { role: 'delivery', sequence: 3, status: 'found', phone: '610-555-0003', source: 'google_places' },
  ] } };
  assert.equal(importedStopContact({ role: 'delivery', sequence: 3 }, state, true).phone, '610-555-0003');
  const ownPhone = importedStopContact({ role: 'delivery', sequence: 3, phone: '610-555-9999' }, state, true);
  assert.equal(ownPhone.phone, '610-555-9999');
  assert.equal(ownPhone.phoneSource, 'broker_document');
});

test('PDF content and assignment remain available while background contacts are pending', async () => {
  let resolveLookup;
  const pending = new Promise(resolve => { resolveLookup = resolve; });
  let result;
  const cleanup = startImportContacts(() => pending, value => { result = value; });
  assert.equal(typeof cleanup, 'function', 'lookup starts without returning a promise to await');
  const visibleStop = importedStopContact(uiStop, null, true);
  assert.equal(visibleStop.address, '7150 Ambassador Dr');
  assert.equal(visibleStop.contactPending, true);
  assert.equal(canAssignImportedLoad({ previewTicket: { signature: 'ticket' } }, 'driver', [{ id: 'driver' }]), true);
  assert.equal(result, undefined);
  resolveLookup({ contacts: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, { data: { contacts: [] } });
  cleanup();
});

test('late results from a previous PDF are discarded and its request is aborted', async () => {
  let resolveLookup, signal, called = false;
  const cleanup = startImportContacts(requestSignal => {
    signal = requestSignal;
    return new Promise(resolve => { resolveLookup = resolve; });
  }, () => { called = true; });
  await Promise.resolve();
  cleanup();
  assert.equal(signal.aborted, true);
  resolveLookup({ contacts: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called, false);
});

test('failed background lookup reports a contact error, not a document error', async () => {
  let state;
  const cleanup = startImportContacts(async () => { throw Error('provider timeout'); }, value => { state = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { error: true });
  const view = importedStopContact({ ...uiStop, role: 'pickup', sequence: 1, facility: 'Shipper' }, state, true);
  assert.equal(view.facility, 'Shipper');
  assert.equal(view.contactError, true);
  assert.equal(view.contactPending, false);
  cleanup();
});
