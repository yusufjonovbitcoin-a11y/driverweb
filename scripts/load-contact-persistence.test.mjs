import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

async function compiledModule(path) {
  const bundle = await rolldown({ input: path });
  const { output } = await bundle.generate({ format: 'es' });
  await bundle.close();
  return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
}
const { persistStopContact } = await compiledModule('supabase/functions/_shared/load-contact-persistence.ts');
const { findStopContact } = await compiledModule('supabase/functions/_shared/load-contact-lookup.ts');
const stop = { id: 'stop-2', type: 'delivery', facility_name: 'Receiver', address_line: '2 Main St',
  city: 'Dallas', region: 'TX', postal_code: '75001', contact_phone: null, contact_source: 'broker_document', contact_place_id: null };
const result = { contact: { status: 'found', source: 'google_places', phone: '214-555-1234' }, placeId: 'place-2' };
function database(response = { error: null }) {
  const calls = [];
  const query = { update(value) { calls.push(['update', value]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; }, is(...args) { calls.push(['is', ...args]); return this; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); } };
  return { calls, from(table) { assert.equal(table, 'load_stops'); return query; } };
}
test('only Place ID persists, with stop identity and null CAS guards', async () => {
  const db = database();
  await persistStopContact(db, 'load-1', stop, result);
  assert.deepEqual(db.calls[0], ['update', { contact_place_id: 'place-2' }]);
  assert.ok(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'load_id', 'load-1'])));
  assert.ok(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['is', 'contact_place_id', null])));
  assert.ok(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'address_line', '2 Main St'])));
});
test('existing Place IDs and absent lookup IDs do not mutate data', async () => {
  for (const [existing, lookup] of [[{ ...stop, contact_place_id: 'old' }, result], [stop, { ...result, placeId: null }]]) {
    const db = database(); await persistStopContact(db, 'load-1', existing, lookup); assert.equal(db.calls.length, 0);
  }
});
test('document/manual phones remain untouched when a Place ID is saved', async () => {
  const db = database(); await persistStopContact(db, 'load-1', { ...stop, contact_phone: '214-555-9999', contact_source: 'manual' }, result);
  assert.deepEqual(db.calls[0][1], { contact_place_id: 'place-2' });
  const response = await findStopContact({ ...stop, contact_phone: '214-555-9999', contact_source: 'manual' }, 'unused', async () => { throw Error('must not call Places'); });
  assert.equal(response.contact.phone, '214-555-9999');
  assert.equal(response.contact.source, 'manual');
});
test('provider phone values are never read from permanent storage', async () => {
  let calls = 0;
  const response = await findStopContact({ ...stop, contact_phone: '214-555-1234', contact_source: 'google_places', contact_place_id: 'place-2' }, 'unused', async () => {
    calls += 1; return Response.json({}, { status: 503 });
  });
  assert.ok(calls > 0);
  assert.equal(response.contact.phone, null);
  assert.equal(response.contact.status, 'provider_error');
});
test('database failures preserve only a safe SQLSTATE for diagnostic logging', async () => {
  await assert.rejects(persistStopContact(database({ error: { code: '23514', message: 'private row data' } }), 'load-1', stop, result),
    error => error.code === '23514' && error.message === 'CONTACT_SAVE_FAILED');
});
