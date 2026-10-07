import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';
import { isDocumentCheckWorker, beforeDocumentDeadline, sanitizeDocumentReview } from '../supabase/functions/_shared/document-check-worker.ts';

// Execute the actual Edge entry point with fake providers; never contacts
// Supabase/OpenAI and never reads developer credentials.
const bundle = await rolldown({
  input: new URL('../supabase/functions/check-load-document/index.ts', import.meta.url).pathname,
  plugins: [{ name: 'fake-supabase', resolveId(id) {
    if (id.startsWith('https://esm.sh/@supabase/')) return '\0fake-supabase';
  }, load(id) { if (id === '\0fake-supabase') return 'export const createClient = () => globalThis.testClient;'; } }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();
const token = 'a'.repeat(64);
function harness({ idle = false, visible = true, validUser = true, providerStatus = 'completed', storageFails = false, stale = false, documentType = 'bol', discrepancies = [], cached = null, cachedAfterClaim = false, stops = [], stopId = null, pickupAddress = null, deliveryAddress = null, privateCache = false } = {}) {
  let handler, authCalls = 0;
  const requests = [], calls = [], tables = [];
  const client = {
    auth: { getUser: async () => { authCalls++; return { data: { user: validUser ? { id: 'user' } : null } }; } },
    storage: { from: () => ({ download: async () => {
      if (storageFails) throw new Error('signed-provider-url-secret');
      return { data: new Blob(['%PDF-test']) };
    } }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'consume_edge_rate_limit') return { data: true };
      if (name === 'claim_document_check') return { data: idle ? null : { jobId: 'job', versionId: 'version', checkId: 'check' } };
      assert.equal(name, 'finish_document_check'); return { data: !stale };
    },
    from(table) {
      tables.push(table); let selected;
      const query = { select(fields) { selected = fields; return this; }, eq() { return this; }, limit() { return this; },
        order() { return this; }, then(resolve) { resolve({ data: table === 'load_stops' ? stops : [] }); },
        async maybeSingle() {
          if (table === 'document_versions') return { data: visible ? { id: 'version' } : null };
          if (table === 'document_review_overview') return { data: { check_result: privateCache ? null : cached } };
          assert.equal(table, 'document_checks');
          return { data: { id: 'check', status: cached && (!cachedAfterClaim || selected.includes('confidence')) ? 'warning' : selected.includes('confidence') ? 'checking' : 'queued', result: cached } };
        },
        async single() {
          if (table === 'document_versions') return { data: { id: 'version', document_id: 'document', file_name: 'test.pdf', mime_type: 'application/pdf', storage_path: 'fixture', size_bytes: 10 } };
          if (table === 'documents') return { data: { id: 'document', load_id: 'load', document_type: documentType, stop_id: stopId } };
          assert.equal(table, 'loads'); return { data: { load_number: 'TEST-42', ...(selected.split(',').includes('broker_rate') ? { broker_rate: 98765 } : {}) } };
        } };
      return query;
    },
  };
  const environment = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test', OPENAI_API_KEY: 'test', DOCUMENT_CHECK_WORKER_TOKEN: token };
  vm.runInNewContext(output[0].code, {
    testClient: client, Deno: { env: { get: name => environment[name] }, serve: fn => { handler = fn; } },
    console: { error() {} }, AbortSignal, Response, Request, Headers, URL, crypto, Uint8Array, btoa, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses'); requests.push(JSON.parse(options.body));
      assert.ok(options.signal instanceof AbortSignal, 'provider request bounded by deadline');
      return Response.json({ status: providerStatus, output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        documentReadable: true, documentMatchesLoad: !discrepancies.length, signaturePresent: true, confidence: 1, extractedLoadNumber: 'TEST-42', discrepancies,
        extractedPickupAddress: pickupAddress, extractedDeliveryAddress: deliveryAddress,
      }) }] }] });
    },
  });
  return { requests, calls, tables, get authCalls() { return authCalls; },
    run(headers = { 'X-Worker-Token': token }, body = {}) {
      return handler(new Request('https://test.invalid/check', { method: 'POST', headers, body: JSON.stringify(body) }));
    } };
}
test('worker credential fails closed for missing, malformed, wrong and partial tokens', () => {
  for (const supplied of ['', 'b'.repeat(64), token.slice(1), `${token}a`]) {
    assert.equal(isDocumentCheckWorker(new Request('https://test.invalid', { headers: { 'X-Worker-Token': supplied } }), token), false);
  }
  assert.equal(isDocumentCheckWorker(new Request('https://test.invalid', { headers: { 'X-Worker-Token': token } }), undefined), false);
});
test('anonymous and invalid worker requests return 401 before any queue or AI work', async () => {
  const h = harness();
  for (const headers of [{}, { 'X-Worker-Token': 'b'.repeat(64) }]) assert.equal((await h.run(headers)).status, 401);
  assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
});
test('foreground requests still require valid user session and document RLS visibility', async () => {
  for (const [options, status] of [[{ validUser: false }, 401], [{ visible: false }, 404]]) {
    const h = harness(options); assert.equal((await h.run({ Authorization: 'Bearer user' }, { versionId: 'version' })).status, status);
    assert.equal(h.authCalls, 1); assert.equal(h.calls.some(c => c.name === 'claim_document_check'), false); assert.equal(h.requests.length, 0);
  }
});
test('scheduled consumer is bounded to one durable job and idle does not call AI', async () => {
  const h = harness({ idle: true }); const response = await h.run();
  assert.deepEqual(await response.json(), { claimed: 0, completed: 0 }); assert.equal(h.authCalls, 0);
  assert.equal(h.requests.length, 0); assert.equal(h.calls[0].args.target_version_id, null);
});
test('foreground and scheduled requests share claim/finish leases and original PDF input', async () => {
  for (const worker of [true, false]) {
    const h = harness(); const response = await h.run(worker ? undefined : { Authorization: 'Bearer user' }, worker ? {} : { versionId: 'version' });
    assert.equal(response.status, 200); assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].input[0].content[0].type, 'input_file'); assert.equal(h.requests[0].store, false);
    const claim = h.calls.find(c => c.name === 'claim_document_check'), finish = h.calls.find(c => c.name === 'finish_document_check');
    assert.equal(finish.args.worker_id, claim.args.worker_id); assert.equal(finish.args.target_job_id, 'job'); assert.equal(finish.args.next_status, 'passed');
  }
});
test('duplicate live foreground lease makes no second paid provider call', async () => {
  const h = harness({ idle: true }); assert.equal((await h.run({ Authorization: 'Bearer user' }, { versionId: 'version' })).status, 409);
  assert.equal(h.requests.length, 0);
});
test('provider failures become durable retry without leaking raw provider exceptions', async () => {
  for (const options of [{ providerStatus: 'incomplete' }, { storageFails: true }]) {
    const h = harness(options); const response = await h.run(); assert.equal(response.status, 502);
    assert.equal(h.calls.at(-1).args.next_status, 'failed_to_read'); assert.equal(JSON.stringify(h.calls).includes('signed-provider-url-secret'), false);
  }
});
test('late completion cannot report success after losing the database lease', async () => {
  const h = harness({ stale: true }); assert.equal((await h.run()).status, 409);
});
test('hung download expires before stale lease can be reclaimed', async () => {
  await assert.rejects(beforeDocumentDeadline(new Promise(() => {}), Date.now() + 2), /deadline exceeded/);
});
test('operational documents neither send broker prices nor persist/return financial discrepancies', async () => {
  const discrepancies = [
    { code: 'rate_mismatch', params: { field: 'rate', expected: '98765', actual: '12' } },
    { code: 'document_mismatch', params: { field: 'load.brokerRate', expected: '98765', actual: '12' } },
    { code: 'document_field_missing', params: { field: 'driver_pay.amount', expected: '98765', actual: null } },
  ];
  for (const documentType of ['bol', 'pod', 'photo', 'other', 'invoice']) {
    const h = harness({ documentType, discrepancies }); const response = await h.run();
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.status, 'passed');
    assert.equal(JSON.stringify(h.requests).includes('98765'), false);
    assert.equal(h.requests[0].text.format.schema.properties.discrepancies.items.properties.code.enum.includes('rate_mismatch'), false);
    assert.deepEqual(result.result.discrepancies, []); assert.deepEqual(result.warnings, []);
    assert.equal(JSON.stringify(h.calls.at(-1)).includes('98765'), false);
  }
});
test('authorized Rate Con retains financial comparison; inaccessible Rate Con never reaches AI', async () => {
  const discrepancy = { code: 'rate_mismatch', params: { field: 'brokerRate', expected: '98765', actual: '12' } };
  const h = harness({ documentType: 'rate_confirmation', discrepancies: [discrepancy] });
  const result = await (await h.run({ Authorization: 'Bearer staff' }, { versionId: 'version' })).json();
  assert.equal(JSON.stringify(h.requests).includes('98765'), true); assert.equal(result.status, 'warning');
  assert.equal(h.requests[0].text.format.schema.properties.discrepancies.items.properties.code.enum.includes('rate_mismatch'), true);
  assert.deepEqual(result.result.discrepancies, [discrepancy]);
  const hidden = harness({ documentType: 'rate_confirmation', visible: false });
  assert.equal((await hidden.run({ Authorization: 'Bearer hidden-driver' }, { versionId: 'version' })).status, 404);
  assert.equal(hidden.requests.length, 0);
});
test('cached operational checks use the same safe projection without provider calls or row rewrites', async () => {
  const cached = {
    documentReadable: true, documentMatchesLoad: false, confidence: 0.9,
    summary: 'Historical broker price 98765', brokerRate: 98765,
    discrepancies: [
      { code: 'rate_mismatch', params: { field: 'brokerRate', expected: '98765', actual: '12' } },
      { code: 'pickup_address_mismatch', severity: 'warning', params: { field: 'pickup.address', expected: 'A', actual: 'B', brokerRate: 98765 } },
    ],
  };
  const original = structuredClone(cached);
  for (const cachedAfterClaim of [false, true]) {
    const h = harness({ cached, cachedAfterClaim });
    const response = await h.run(cachedAfterClaim ? undefined : { Authorization: 'Bearer user' }, cachedAfterClaim ? {} : { versionId: 'version' });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.duplicate, true);
    assert.deepEqual(result.result, JSON.parse(JSON.stringify(sanitizeDocumentReview(cached, false))));
    assert.equal(JSON.stringify(result).includes('98765'), false);
    assert.equal(result.result.discrepancies[0].code, 'pickup_address_mismatch');
    assert.equal(h.requests.length, 0); assert.equal(h.calls.some(call => call.name === 'finish_document_check'), false);
    if (!cachedAfterClaim) assert.equal(h.calls.some(call => call.name === 'claim_document_check'), false);
  }
  assert.deepEqual(cached, original, 'projection must not mutate historical source');
  const staff = harness({ documentType: 'rate_confirmation', cached });
  const result = await (await staff.run({ Authorization: 'Bearer staff' }, { versionId: 'version' })).json();
  assert.deepEqual(result.result, cached, 'authorized Rate Con financial review is preserved');
  assert.equal(staff.requests.length, 0);
  const hidden = harness({ privateCache: true, cached: { ...cached, discrepancies: [
    { code: 'document_mismatch', params: { field: 'arbitrary', expected: '98765' } },
  ] } });
  const privateResult = await (await hidden.run({ Authorization: 'Bearer private-driver' }, { versionId: 'version' })).json();
  assert.equal(privateResult.status, 'warning');
  assert.equal(JSON.stringify(privateResult).includes('98765'), false);
  assert.equal(hidden.tables.includes('document_review_overview'), true);
  assert.equal(hidden.requests.length, 0);
});
test('later pickup/delivery documents compare their bound stop, never the first or ambiguous opposite endpoint', async () => {
  const stops = [
    { id: 'P1', type: 'pickup', sequence: 1, address_line: '100 First Street' },
    { id: 'P2', type: 'pickup', sequence: 2, address_line: '200 Second Street' },
    { id: 'D1', type: 'delivery', sequence: 3, address_line: '300 Third Street' },
    { id: 'D2', type: 'delivery', sequence: 4, address_line: '400 Fourth Street' },
  ];
  for (const [stopId, documentType, field, expected] of [
    ['P2', 'bol', 'pickup', '200 Second Street'], ['D2', 'pod', 'delivery', '400 Fourth Street'],
  ]) {
    const opposite = field === 'pickup' ? 'delivery' : 'pickup';
    const options = { stops, stopId, documentType, [`${field}Address`]: expected,
      [`${opposite}Address`]: '999 Unrelated Street', discrepancies: [
        { code: `${opposite}_address_mismatch`, params: { field: `${opposite}.address`, expected: 'Wrong first stop', actual: '999 Unrelated Street' } },
      ] };
    const good = harness(options); const result = await (await good.run()).json();
    assert.equal(result.status, 'passed'); assert.deepEqual(result.warnings, []);
    const context = JSON.parse(good.requests[0].input[0].content[1].text);
    assert.equal(context.boundStopId, stopId); assert.deepEqual(context.stops.map(s => s.id), [stopId]);
    const bad = harness({ ...options, [`${field}Address`]: '888 Unrelated Street' });
    const wrong = await (await bad.run()).json();
    assert.equal(wrong.status, 'warning'); assert.equal(wrong.warnings.length, 1);
    assert.equal(wrong.warnings[0].code, `${field}_address_mismatch`);
    assert.equal(wrong.warnings[0].params.expected, expected);
  }
  const legacy = harness({ stops: [stops[0], stops[2]], pickupAddress: '100 First Street', deliveryAddress: '300 Third Street' });
  assert.equal((await (await legacy.run()).json()).status, 'passed');
  assert.equal(JSON.parse(legacy.requests[0].input[0].content[1].text).stops.length, 2);
});
