import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';
import { issueLoadPreviewTicket } from '../supabase/functions/_shared/load-preview-ticket.ts';

// Real Edge handler, isolated authentication/database/provider stubs. No writes,
// external data transfers, real API keys or paid Places calls occur in tests.
const bundle = await rolldown({
  input: new URL('../supabase/functions/lookup-load-contacts/index.ts', import.meta.url).pathname,
  plugins: [{ name: 'fake-supabase', resolveId(id) {
    if (id.startsWith('https://esm.sh/@supabase/')) return '\0fake-supabase';
  }, load(id) {
    if (id === '\0fake-supabase') return 'export const createClient = () => globalThis.testClient;';
  } }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();
const binding = { actorId: 'actor', companyId: 'company', checksum: 'checksum',
  fileName: 'rate.pdf', mimeType: 'application/pdf', version: 17 };
const candidate = { extractionMode: 'ai_pdf_direct', loadNumber: '42', pickupCount: 1, deliveryCount: 2,
  requirements: [], contractTerms: [], evidence: [],
  stops: [
    { role: 'pickup', facilityName: 'Pickup', addressLine: '1 First Ave', city: 'Phoenix', region: 'AZ', contactPhone: '602-555-0001' },
    { role: 'delivery', facilityName: 'Receiver', addressLine: '2 Second Ave', city: 'Dallas', region: 'TX' },
    { role: 'delivery', city: 'Flanders', region: 'NJ' },
  ], documentReview: { documentReadable: true, singleLoad: true, allPagesRead: true, pageCount: 1,
    operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] },
};
function harness({ role = 'dispatcher', status = 'active', companyId = 'company', providerFailure = false } = {}) {
  let handler;
  const tables = [], requests = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: async name => { assert.equal(name, 'consume_edge_rate_limit'); return { data: true }; },
    from(name) {
      tables.push(name);
      assert.equal(name, 'profiles', 'preview must not read/write loads, stops, documents or Storage');
      return { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { id: 'actor', company_id: companyId, role, status } }) };
    },
  };
  const environment = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test',
    SUPABASE_SERVICE_ROLE_KEY: 'secret', GOOGLE_PLACES_API_KEY: 'test' };
  vm.runInNewContext(output[0].code, {
    testClient: client, Deno: { env: { get: name => environment[name] }, serve: fn => { handler = fn; } },
    AbortSignal, Response, Request, Headers, URL, crypto, TextEncoder, Uint8Array, console,
    fetch: async (url, options) => {
      assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(body.textQuery, 'Receiver, 2 Second Ave, Dallas, TX');
      if (providerFailure) return Response.json({ error: { message: 'Unavailable' } }, { status: 503 });
      return Response.json({ places: [{ id: 'receiver-place', displayName: { text: 'Receiver' },
        formattedAddress: '2 Second Ave, Dallas, TX', nationalPhoneNumber: '214-555-0002',
        addressComponents: [['street_number', '2'], ['route', 'Second Avenue'], ['locality', 'Dallas'],
          ['administrative_area_level_1', 'TX'], ['country', 'US']]
          .map(([type, value]) => ({ types: [type], longText: value, shortText: value })) }] });
    },
  });
  return { tables, requests, run: (body, auth = true) => handler(new Request('https://test.invalid/lookup-load-contacts', {
    method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {}, body: JSON.stringify(body),
  })) };
}

test('signed preview resolves only missing stop phones, preserves sequence and creates no records', async () => {
  const previewTicket = await issueLoadPreviewTicket(candidate, binding, 'secret');
  const h = harness();
  const response = await h.run({ previewTicket });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.tables, ['profiles']);
  assert.deepEqual(body.contacts.map(c => [c.sequence, c.role, c.phone]), [
    [1, 'pickup', '602-555-0001'], [2, 'delivery', '214-555-0002'], [3, 'delivery', null],
  ]);
  assert.equal(body.contacts[0].source, 'broker_document');
  assert.equal(body.contacts[1].source, 'google_places');
});

test('foreign, edited and expired tickets cannot send preview addresses to Google', async () => {
  const ticket = await issueLoadPreviewTicket(candidate, binding, 'secret');
  const cases = [
    { ...ticket, payload: ticket.payload.replace('Dallas', 'Houston') },
    await issueLoadPreviewTicket(candidate, { ...binding, actorId: 'other' }, 'secret'),
    await issueLoadPreviewTicket(candidate, { ...binding, companyId: 'other' }, 'secret'),
    await issueLoadPreviewTicket(candidate, binding, 'secret', Date.now() - 31 * 60_000),
  ];
  for (const previewTicket of cases) {
    const h = harness();
    assert.equal((await h.run({ previewTicket })).status, 400);
    assert.equal(h.requests.length, 0);
  }
});

test('anonymous, driver and inactive users cannot enrich a staff preview', async () => {
  const previewTicket = await issueLoadPreviewTicket(candidate, binding, 'secret');
  const anonymous = harness();
  assert.equal((await anonymous.run({ previewTicket }, false)).status, 401);
  assert.equal(anonymous.requests.length, 0);
  for (const options of [{ role: 'driver' }, { status: 'inactive' }, { companyId: null }]) {
    const h = harness(options);
    assert.equal((await h.run({ previewTicket })).status, 403);
    assert.equal(h.requests.length, 0);
  }
});

test('invalid inputs and mixed saved/preview requests never reach the provider', async () => {
  const previewTicket = await issueLoadPreviewTicket(candidate, binding, 'secret');
  for (const payload of [{ stops: candidate.stops }, { loadId: 'saved', previewTicket }, { previewTicket: {} }]) {
    const h = harness();
    assert.equal((await h.run(payload)).status, 400);
    assert.equal(h.requests.length, 0);
  }
});

test('provider failure stays a per-stop error and does not discard other phones', async () => {
  const previewTicket = await issueLoadPreviewTicket(candidate, binding, 'secret');
  const h = harness({ providerFailure: true });
  const response = await h.run({ previewTicket });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.contacts[0].phone, '602-555-0001');
  assert.equal(body.contacts[1].status, 'provider_error');
  assert.equal(body.contacts[2].status, 'not_found');
});
