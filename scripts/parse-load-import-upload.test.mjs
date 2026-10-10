import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

// Execute the actual bundled Edge handler. Only external Supabase/OpenAI I/O is
// replaced. The stateful fake models commits surviving a failed HTTP response;
// SQL authorization and object metadata checks have separate database tests.
const bundle = await rolldown({
  input: new URL('../supabase/functions/parse-load-document/index.ts', import.meta.url).pathname,
  plugins: [{ name: 'isolated-supabase', resolveId(id) {
    if (id.startsWith('https://esm.sh/@supabase/')) return '\0isolated-supabase';
  }, load(id) {
    if (id === '\0isolated-supabase') return 'export const createClient = (...args) => globalThis.createTestClient(...args);';
  } }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();
const DRIVER = '11111111-1111-4111-8111-111111111111';
const STORAGE_PATH = 'company/load/document/version/rate.pdf';
const clone = value => value == null ? value : structuredClone(value);

function providerExtraction() {
  const fact = value => ({ value, page: 1, quote: value });
  return {
    loadNumber: fact('TEST-42'), requirements: [],
    documentReview: { documentReadable: true, singleLoad: true, pageCount: 1, allPagesRead: true,
      operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] },
    stops: [
      { role: 'pickup', addressLine: fact('1 First Ave'), city: fact('Phoenix'), region: fact('AZ') },
      { role: 'delivery', addressLine: fact('2 Second Ave'), city: fact('Dallas'), region: fact('TX') },
    ],
  };
}

function harness(options = {}) {
  const events = [];
  const state = { imports: [], loads: [], assignments: [], files: new Map(), currentVersion: null,
    createCount: 0, versionCount: 0, aiCalls: 0, planCalls: 0, uploadCalls: 0, completeCalls: 0 };
  let handler;
  let tick = 0;
  const profile = { id: 'actor', company_id: 'company', role: options.role || 'dispatcher', status: options.profileStatus || 'active' };
  function rows(table) {
    switch (table) {
      case 'profiles': return [profile];
      case 'manual_load_imports': return state.imports;
      case 'loads': return state.loads;
      case 'member_directory': return [{ id: DRIVER, role: 'driver', status: 'active' }];
      case 'driver_pay_settings': return [{ driver_id: DRIVER, rate_per_mile: 2 }];
      case 'assignments': return state.assignments;
      case 'documents': return state.currentVersion ? [{ id: 'document', load_id: 'load', document_type: 'rate_confirmation', current_version_id: state.currentVersion }] : [];
      case 'document_versions': return state.currentVersion ? [{ id: state.currentVersion, storage_path: STORAGE_PATH }] : [];
      case 'document_checks': case 'jobs': case 'audit_events': return [];
      default: throw Error(`Unexpected table ${table}`);
    }
  }
  class Query {
    constructor(table, actor) { this.table = table; this.actor = actor; this.filters = []; this.action = 'read'; }
    select(_fields, options) { this.count = options?.head === true; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    gte() { return this; }
    not(key, _operator, value) { this.filters.push(row => row[key] !== value && row[key] !== undefined); return this; }
    order() { return this; } limit() { return this; }
    insert(values) { this.action = 'insert'; this.values = values; return this; }
    update(values) { this.action = 'update'; this.values = values; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    single() { this.singleRow = true; return this; }
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        const selected = rows(this.table).filter(row => this.filters.every(filter => filter(row)));
        events.push({ type: 'query', actor: this.actor, table: this.table, action: this.action, values: clone(this.values) });
        if (this.action === 'insert' && this.table === 'manual_load_imports') {
          assert.equal(state.imports.length, 0, 'same checksum must not create a second import');
          const row = { id: 'import', status: 'processing', ...clone(this.values), updated_at: new Date(Date.now() + ++tick).toISOString() };
          state.imports.push(row); return { data: clone(row), error: null };
        }
        if (this.action === 'update') {
          for (const row of selected) Object.assign(row, clone(this.values), { updated_at: new Date(Date.now() + ++tick).toISOString() });
        }
        return { data: this.singleRow ? clone(selected[0] || null) : clone(selected), count: this.count ? 0 : null, error: null };
      }).then(resolve, reject);
    }
  }
  function client(actor) {
    return {
      auth: { getUser: async () => ({ data: { user: options.invalidSession ? null : { id: profile.id } } }) },
      from: table => new Query(table, actor),
      async rpc(name, args) {
        events.push({ type: 'rpc', actor, name, args: clone(args) });
        if (name === 'consume_edge_rate_limit' || name === 'can_access_driver') return { data: true, error: null };
        if (name === 'begin_document_upload' || name === 'complete_document_upload') {
          return { data: null, error: { message: 'Use staff document management for load-wide documents', code: '42501' } };
        }
        if (name === 'create_document_import_draft') {
          assert.equal(actor, 'caller');
          assert.equal(args.target_import_id, 'import');
          assert.equal(args.expected_checksum, state.imports[0].checksum_sha256);
          if (!state.loads.length) {
            state.loads.push({ id: 'load', company_id: 'company', status: 'draft', current_assignment_id: null });
            state.createCount++; state.imports[0].load_id = 'load';
          }
          return { data: 'load', error: null };
        }
        if (name === 'begin_import_document_upload') {
          state.planCalls++;
          assert.equal(actor, 'caller', 'import upload must retain the authenticated caller');
          assert.deepEqual(Object.keys(args).sort(), ['p_expected_checksum', 'p_import_id']);
          assert.equal(args.p_import_id, 'import');
          assert.equal(args.p_expected_checksum, state.imports[0].checksum_sha256);
          if (options.planError) return { data: null, error: { message: options.planError } };
          if (!state.versionCount) state.versionCount++;
          return { data: { bucket: 'load-documents', documentId: 'document', versionId: 'version',
            versionNumber: 1, storagePath: STORAGE_PATH, uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            alreadyUploaded: state.currentVersion === 'version', ...options.planOverrides }, error: null };
        }
        if (name === 'complete_import_document_upload') {
          state.completeCalls++;
          assert.equal(actor, 'admin', 'only the verified Edge server may attest original bytes');
          assert.deepEqual(Object.keys(args).sort(), ['p_actor_id', 'p_expected_checksum', 'p_import_id', 'p_version_id']);
          assert.equal(args.p_actor_id, profile.id);
          assert.equal(args.p_import_id, 'import'); assert.equal(args.p_version_id, 'version');
          assert.equal(args.p_expected_checksum, state.imports[0].checksum_sha256);
          if (options.completeFailure === 'before-commit' && state.completeCalls === 1)
            return { data: null, error: { message: 'IMPORT_DOCUMENT_COMPLETION_RETRY' } };
          if (options.completeError) return { data: null, error: { message: options.completeError } };
          assert.ok(state.files.has(STORAGE_PATH), 'completion requires original bytes');
          state.currentVersion = 'version';
          if (options.completeFailure === 'after-commit' && state.completeCalls === 1)
            return { data: null, error: { message: 'IMPORT_DOCUMENT_RESPONSE_LOST' } };
          return { data: { id: 'document', load_id: 'load', current_version_id: 'version', ...options.completeOverrides }, error: null };
        }
        if (name === 'review_and_assign_document_load') {
          assert.equal(actor, 'caller'); assert.equal(state.currentVersion, 'version');
          assert.equal(args.target_load_id, 'load'); assert.equal(args.target_driver_id, DRIVER);
          assert.equal(args.source_checksum, state.imports[0].checksum_sha256);
          assert.equal(state.assignments.length, 0, 'retry must not create a second assignment');
          state.assignments.push({ id: 'assignment', driver_id: DRIVER, status: 'active' });
          state.loads[0].current_assignment_id = 'assignment'; state.loads[0].status = 'assigned';
          return { data: null, error: null };
        }
        assert.ok(['refresh_verified_import_draft', 'apply_ai_import_metadata', 'refresh_ai_import_metadata',
          'save_import_ordered_stops'].includes(name), `Unexpected RPC ${name}`);
        return { data: null, error: null };
      },
      storage: { from(bucket) {
        assert.equal(actor, 'caller', 'source upload must not bypass RLS using service role');
        assert.equal(bucket, 'load-documents');
        return { async download(path) {
          events.push({ type: 'download', actor, path });
          if (options.downloadError) return { data: null, error: { message: 'Storage read denied' } };
          const bytes = options.downloadBytes || state.files.get(path);
          return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'Object unavailable' } };
        }, async upload(path, file, settings) {
          state.uploadCalls++; events.push({ type: 'upload', actor, path, settings: clone(settings) });
          assert.equal(path, STORAGE_PATH); assert.equal(settings.upsert, false);
          assert.equal(settings.contentType, 'application/pdf');
          await options.onUpload?.();
          if (options.uploadError && state.uploadCalls === 1) return { data: null, error: options.uploadError };
          if (state.files.has(path)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } };
          state.files.set(path, new Uint8Array(await file.arrayBuffer()));
          return { data: { path }, error: null };
        } };
      } },
    };
  }
  const environment = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service', OPENAI_API_KEY: 'test-ai' };
  vm.runInNewContext(output[0].code, {
    createTestClient: (_url, key) => client(key === 'test-service' ? 'admin' : 'caller'),
    Deno: { env: { get: name => environment[name] }, serve: fn => { handler = fn; } },
    console: { info() {}, error() {} }, performance, AbortSignal, Response, Request, File, FormData, Headers,
    URL, crypto, TextEncoder, TextDecoder, Uint8Array, btoa, Intl, structuredClone, Error,
    fetch: async url => {
      assert.equal(url, 'https://api.openai.com/v1/responses', 'no other network is allowed'); state.aiCalls++;
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(providerExtraction()) }] }] });
    },
  });
  async function run({ preview = false, ticket, auth = true } = {}) {
    const form = new FormData(); form.set('file', new File(['%PDF-1.7\nTest'], 'rate.pdf', { type: 'application/pdf' }));
    if (preview) form.set('previewOnly', 'true');
    if (ticket) {
      form.set('previewPayload', ticket.payload); form.set('previewSignature', ticket.signature); form.set('confirmDriverId', DRIVER);
    }
    const response = await handler(new Request('https://test.invalid/parse-load-document', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {}, body: form,
    }));
    return { status: response.status, body: await response.json() };
  }
  async function preview() {
    const result = await run({ preview: true }); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(state.imports.length, 0); assert.equal(state.loads.length, 0); assert.equal(state.files.size, 0);
    return result.body.preparedLoad.previewTicket;
  }
  return { state, events, run, preview };
}
const rpcs = (h, name) => h.events.filter(event => event.type === 'rpc' && event.name === name);

test('fresh confirmed import uses a caller-bound plan and server-attested completion before assigning once', async () => {
  const h = harness(); const ticket = await h.preview(); const result = await h.run({ ticket });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.assigned, true);
  assert.equal(h.state.createCount, 1); assert.equal(h.state.versionCount, 1); assert.equal(h.state.uploadCalls, 1);
  assert.equal(h.state.assignments.length, 1); assert.equal(h.state.aiCalls, 1);
  assert.equal(h.state.imports[0].storage_path, STORAGE_PATH);
  assert.equal(rpcs(h, 'begin_document_upload').length, 0); assert.equal(rpcs(h, 'complete_document_upload').length, 0);
  const position = name => h.events.findIndex(event => event.name === name);
  assert.ok(position('begin_import_document_upload') < h.events.findIndex(event => event.type === 'upload'));
  assert.ok(position('complete_import_document_upload') < position('review_and_assign_document_load'));
});

test('transient byte upload failure resumes the same draft and does not assign prematurely', async () => {
  const h = harness({ uploadError: { statusCode: '503', message: 'Storage temporarily unavailable' } });
  const ticket = await h.preview(); const first = await h.run({ ticket });
  assert.equal(first.status, 502); assert.equal(first.body.error, 'IMPORT_DOCUMENT_UPLOAD_FAILED');
  assert.equal(h.state.assignments.length, 0); assert.equal(h.state.completeCalls, 0);
  assert.equal(h.state.imports[0].status, 'parse_failed'); assert.equal(h.state.imports[0].load_id, 'load');
  const second = await h.run({ ticket }); assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(h.state.createCount, 1); assert.equal(h.state.imports.length, 1); assert.equal(h.state.versionCount, 1);
  assert.equal(h.state.assignments.length, 1); assert.equal(h.state.aiCalls, 1);
});

test('bytes saved but completion failed: retry handles409 without overwrite and completes the same version', async () => {
  const h = harness({ completeFailure: 'before-commit' });
  const first = await h.run(); assert.equal(first.status, 409); assert.match(first.body.error, /COMPLETION_RETRY/);
  assert.equal(h.state.files.size, 1); assert.equal(h.state.currentVersion, null);
  const original = h.state.files.get(STORAGE_PATH);
  const second = await h.run(); assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(h.state.files.get(STORAGE_PATH), original, 'retry must not overwrite saved bytes');
  assert.equal(h.state.uploadCalls, 2); assert.equal(h.state.completeCalls, 2);
  assert.equal(h.state.versionCount, 1); assert.equal(h.state.createCount, 1); assert.equal(h.state.aiCalls, 1);
});

test('committed completion response lost: retry reuses current source path without uploading again', async () => {
  const h = harness({ completeFailure: 'after-commit' });
  const first = await h.run(); assert.equal(first.status, 409); assert.equal(h.state.currentVersion, 'version');
  const second = await h.run(); assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(h.state.uploadCalls, 1); assert.equal(h.state.completeCalls, 2); assert.equal(h.state.planCalls, 2);
  assert.equal(h.state.imports[0].storage_path, STORAGE_PATH); assert.equal(h.state.aiCalls, 1);
});

test('repeating confirmed Send after assignment cannot create a second draft/version/assignment', async () => {
  const h = harness(); const ticket = await h.preview();
  assert.equal((await h.run({ ticket })).status, 200);
  const again = await h.run({ ticket }); assert.equal(again.status, 409);
  assert.equal(h.state.createCount, 1); assert.equal(h.state.versionCount, 1); assert.equal(h.state.uploadCalls, 1);
  assert.equal(h.state.assignments.length, 1); assert.equal(rpcs(h, 'review_and_assign_document_load').length, 1);
});

test('import-bound authorization error is descriptive and cannot fall back to a privileged upload', async () => {
  const h = harness({ planError: 'IMPORT_DOCUMENT_OWNER_MISMATCH' });
  const ticket = await h.preview(); const result = await h.run({ ticket });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'IMPORT_DOCUMENT_OWNER_MISMATCH');
  assert.equal(h.state.files.size, 0); assert.equal(h.state.assignments.length, 0);
  assert.equal(h.state.imports[0].error_message, 'IMPORT_DOCUMENT_OWNER_MISMATCH');
  assert.equal(rpcs(h, 'begin_document_upload').length, 0);
});

test('a non409 storage authorization failure never attempts completion or assignment', async () => {
  const h = harness({ uploadError: { statusCode: '403', message: 'Storage policy denied this upload' } });
  const ticket = await h.preview(); const result = await h.run({ ticket });
  assert.equal(result.status, 502); assert.equal(h.state.completeCalls, 0); assert.equal(h.state.assignments.length, 0);
});

test('409 is not success: database completion rejection prevents assigning a mismatched object', async () => {
  const h = harness({ uploadError: { statusCode: '409', message: 'The resource already exists' },
    downloadBytes: new TextEncoder().encode('%PDF-1.7\nTest'), completeError: 'IMPORT_DOCUMENT_STORAGE_METADATA_INVALID' });
  const ticket = await h.preview(); const result = await h.run({ ticket });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'IMPORT_DOCUMENT_STORAGE_METADATA_INVALID');
  assert.equal(h.state.completeCalls, 1); assert.equal(h.state.assignments.length, 0);
});

for (const planOverrides of [{ bucket: 'public-bucket' }, { versionId: null }, { documentId: null }, { storagePath: null }, { alreadyUploaded: null }]) {
  test(`invalid import upload plan fails closed: ${Object.keys(planOverrides)[0]}`, async () => {
    const h = harness({ planOverrides }); const ticket = await h.preview(); const result = await h.run({ ticket });
    assert.equal(result.status, 500); assert.equal(result.body.error, 'IMPORT_DOCUMENT_PLAN_INVALID');
    assert.equal(h.state.uploadCalls, 0); assert.equal(h.state.assignments.length, 0);
  });
}

test('completion must return the expected document and current version before assignment', async () => {
  for (const completeOverrides of [{ id: 'wrong-document' }, { load_id: 'other-load' }, { current_version_id: 'wrong-version' }]) {
    const h = harness({ completeOverrides }); const ticket = await h.preview(); const result = await h.run({ ticket });
    assert.equal(result.status, 500); assert.equal(h.state.assignments.length, 0);
    assert.match(result.body.error, /DOCUMENT/);
  }
});

test('anonymous and driver requests never reach source-upload planning or AI', async () => {
  const anonymous = harness(); assert.equal((await anonymous.run({ auth: false })).status, 401);
  const driver = harness({ role: 'driver' }); assert.equal((await driver.run()).status, 403);
  for (const h of [anonymous, driver]) {
    assert.equal(h.state.aiCalls, 0); assert.equal(h.state.planCalls, 0); assert.equal(h.state.imports.length, 0);
  }
});

for (const completeFailure of ['before-commit', 'after-commit']) {
  test(`retry hashes stored bytes instead of trusting matching object size: ${completeFailure}`, async () => {
    const h = harness({ completeFailure }); const ticket = await h.preview();
    assert.equal((await h.run({ ticket })).status, 409);
    const corrupt = new Uint8Array(h.state.files.get(STORAGE_PATH));
    corrupt[corrupt.length - 1] ^= 1;
    h.state.files.set(STORAGE_PATH, corrupt);
    const result = await h.run({ ticket });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'IMPORT_DOCUMENT_SOURCE_MISMATCH');
    assert.equal(h.state.completeCalls, 1); assert.equal(h.state.assignments.length, 0);
    assert.equal(h.events.filter(event => event.type === 'download').length, 1);
    assert.equal(h.state.aiCalls, 1);
  });
}

test('unreadable stored source cannot be attested or assigned on409 retry', async () => {
  const h = harness({ completeFailure: 'before-commit', downloadError: true });
  const ticket = await h.preview(); assert.equal((await h.run({ ticket })).status, 409);
  const result = await h.run({ ticket });
  assert.equal(result.status, 502); assert.equal(result.body.error, 'IMPORT_DOCUMENT_VERIFY_FAILED');
  assert.equal(h.state.completeCalls, 1); assert.equal(h.state.assignments.length, 0);
});

test('another staff creator cannot claim or mutate an incomplete import before upload authorization', async () => {
  const h = harness({ uploadError: { statusCode: '503', message: 'temporary' } });
  assert.equal((await h.run()).status, 502);
  h.state.imports[0].created_by = 'another-staff-member';
  const previous = clone(h.state.imports[0]); const eventStart = h.events.length;
  const result = await h.run();
  assert.equal(result.status, 403); assert.equal(result.body.error, 'IMPORT_DOCUMENT_PERMISSION_DENIED');
  assert.deepEqual(h.state.imports[0], previous);
  assert.equal(h.events.slice(eventStart).filter(event => event.type === 'query' && event.action !== 'read').length, 0);
  assert.equal(h.state.planCalls, 1); assert.equal(h.state.aiCalls, 1);
});

test('concurrent confirmation during source upload returns pending without a second upload or assignment', async () => {
  let announceUpload; let finishUpload;
  const started = new Promise(resolve => { announceUpload = resolve; });
  const hold = new Promise(resolve => { finishUpload = resolve; });
  const h = harness({ onUpload: async () => { announceUpload(); await hold; } });
  const ticket = await h.preview();
  const first = h.run({ ticket });
  await started;
  let pending;
  try { pending = await h.run({ ticket }); }
  finally { finishUpload(); }
  assert.equal(pending.status, 202); assert.deepEqual(pending.body, { processing: true, importId: 'import' });
  const completed = await first; assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(h.state.planCalls, 1); assert.equal(h.state.uploadCalls, 1);
  assert.equal(h.state.createCount, 1); assert.equal(h.state.assignments.length, 1); assert.equal(h.state.aiCalls, 1);
});
