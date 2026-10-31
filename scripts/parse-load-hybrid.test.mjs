import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

const bundle = await rolldown({
  input: fileURLToPath(new URL('../supabase/functions/parse-load-document/index.ts', import.meta.url)),
  plugins: [{ name: 'isolated-providers', resolveId(id) {
    if (id.startsWith('https://esm.sh/@supabase/')) return '\0supabase';
    if (id === 'npm:unpdf@1.8.1') return '\0pdf';
  }, load(id) {
    if (id === '\0supabase') return 'export const createClient = () => globalThis.testClient;';
    if (id === '\0pdf') return 'export const getDocumentProxy = bytes => globalThis.loadTestPdf(bytes); export const getResolvedPDFJS = () => globalThis.testPdfModule();';
  } }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();

async function harness({ conflict = false, role = 'dispatcher', repair = false, savedImport = null, documentBytes } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = ['Load # TEST-42', 'Pickup', '1 First Ave', 'Phoenix, AZ 85001', 'Delivery',
    '2 Second Ave, Dallas, TX 75001', 'Dallas, TX 75001'];
  if (conflict) lines.push('2 Second Ave, Dallas, Texas 75002');
  const positions = [750, 690, 670, 650, 570, 550, 530, 510];
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: positions[i], font, size: 12 }));
  const bytes = documentBytes ?? await pdf.save();
  const requests = []; const writes = []; let handler; let parserCalls = 0;
  const testClient = { auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: async name => { assert.equal(name, 'consume_edge_rate_limit'); return { data: true }; },
    from(table) {
      if (table === 'manual_load_imports') {
        const filters = new Map();
        return { select() { return this; }, eq(key, value) { filters.set(key, value); return this; }, maybeSingle: async () => {
          assert.equal(filters.get('company_id'), 'company-a'); assert.equal(filters.get('created_by'), 'actor');
          assert.equal(filters.get('checksum_sha256'), Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'));
          assert.equal(filters.get('extraction_schema_version'), 1019);
          return { data: savedImport };
        } };
      }
      assert.equal(table, 'profiles');
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: {
        id: 'actor', company_id: 'company-a', role, status: 'active',
      } }), insert() { writes.push(table); }, update() { writes.push(table); } };
    } };
  const environment = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test',
    SUPABASE_SERVICE_ROLE_KEY: 'test', OPENAI_API_KEY: 'test' };
  const fact = (field, value, ...source_ids) => ({ field, value, source_ids });
  const response = { facts: [fact('loadNumber', 'TEST-42', 'p1b0')], requirements: [], contractTerms: [],
    documentReview: { documentReadable: true, singleLoad: true, allPagesRead: true, pageCount: 1,
      operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] },
    stops: [{ role: 'pickup', anchor_ids: ['p1b1'], facts: [fact('addressLine', '1 First Ave', 'p1b2'),
      fact('city', 'Phoenix', 'p1b3'), fact('region', 'AZ', 'p1b3'), fact('postalCode', '85001', 'p1b3')] },
    { role: 'delivery', anchor_ids: ['p1b4'], facts: [fact('addressLine', '2 Second Ave', 'p1b5'),
      fact('city', 'Dallas', 'p1b6'), fact('region', 'TX', 'p1b6'), fact('postalCode', '75001', 'p1b5')] }],
  };
  if (repair) response.stops[1].facts.find(item => item.field === 'city').value = 'Invented City';
  vm.runInNewContext(output[0].code, { testClient,
    loadTestPdf: data => { parserCalls++; return getDocumentProxy(data); }, testPdfModule: getResolvedPDFJS,
    Deno: { env: { get: name => environment[name] }, serve: value => { handler = value; } },
    console: { info() {}, error() {} }, performance, AbortSignal, Response, Request, File, FormData, Headers,
    URL, crypto, TextEncoder, TextDecoder, Uint8Array, btoa, Intl, structuredClone,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      requests.push(JSON.parse(options.body));
      const result = repair && requests.length > 1 ? { repairs: [
        { field: 'stops.1.city', value: 'Dallas', source_ids: ['p1b6'] },
        { field: 'loadNumber', value: 'ATTACK', source_ids: ['p1b0'] },
      ] } : response;
      return Response.json({ status: 'completed', model: 'test-model', usage: { input_tokens: 10, output_tokens: 10 },
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
    },
  });
  return { bytes, requests, writes, get parserCalls() { return parserCalls; }, async preview() {
    const form = new FormData(); form.set('previewOnly', 'true');
    form.set('file', new File([bytes], 'test.pdf', { type: 'application/pdf' }));
    return handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: form }));
  }, async confirm(ticket) {
    const form = new FormData(); form.set('file', new File([bytes], 'test.pdf', { type: 'application/pdf' }));
    form.set('previewPayload', ticket.payload); form.set('previewSignature', ticket.signature);
    form.set('confirmDriverId', '11111111-1111-4111-8111-111111111111');
    return handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: form }));
  } };
}

test('normal preview parses a real PDF on the server and sends only indexed text to AI', async () => {
  const h = await harness(); const response = await h.preview(); const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(h.parserCalls, 1); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].input[0].content.length, 1);
  assert.equal(h.requests[0].input[0].content[0].type, 'input_text');
  assert.equal(result.preparedLoad.review.sourceGrounded, true);
  assert.equal(result.preparedLoad.loadNumber, '#TEST-42');
  assert.equal(result.preparedLoad.id, null); assert.ok(result.preparedLoad.previewTicket.signature);
  assert.deepEqual(h.writes, []);
});

test('selecting an identical file twice reuses a bound preview without another paid call', async () => {
  const h = await harness();
  assert.equal((await h.preview()).status, 200);
  assert.equal((await h.preview()).status, 200);
  assert.equal(h.requests.length, 1); assert.equal(h.parserCalls, 1);
});

test('a compatible saved import survives a cold isolate without another parser or AI call', async () => {
  const original = await harness(); const preview = await (await original.preview()).json();
  const ticket = JSON.parse(preview.preparedLoad.previewTicket.payload);
  const savedImport = { status: 'needs_review', load_id: 'existing-load', extracted_result: {},
    extraction_schema_version: ticket.version, raw_extraction: { candidate: ticket.candidate,
      audit: { method: 'hybrid_pdf_v1', independentAudit: false } } };
  const cold = await harness({ savedImport, documentBytes: original.bytes });
  const response = await cold.preview();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(cold.requests.length, 0); assert.equal(cold.parserCalls, 0);
  assert.deepEqual(cold.writes, []);
});

test('one bounded text retry repairs only the failed slot and cannot replace verified fields', async () => {
  const h = await harness({ repair: true });
  const response = await h.preview(); const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].input[0].content.length, 1);
  assert.equal(h.requests[1].input[0].content[0].type, 'input_text');
  assert.ok(h.requests[1].input[0].content[0].text.length < 6500);
  assert.equal(result.preparedLoad.loadNumber, '#TEST-42');
  assert.ok(result.preparedLoad.documentDetails.fields.some(field => field.key === 'stops.1.city' && field.value === 'Dallas'));
  assert.deepEqual(h.writes, []);
});

test('driver role cannot reach the parser, cache or model', async () => {
  const h = await harness({ role: 'driver' });
  assert.equal((await h.preview()).status, 403);
  assert.equal(h.requests.length, 0); assert.equal(h.parserCalls, 0);
});

test('a detected source conflict is visible and final confirmation cannot write or call AI again', async () => {
  const h = await harness({ conflict: true }); const preview = await (await h.preview()).json();
  const issue = preview.preparedLoad.review.issues.find(issue => issue.reason === 'conflicting_postal_codes');
  assert.deepEqual(issue.alternatives, ['75001', '75002']);
  const confirmed = await h.confirm(preview.preparedLoad.previewTicket);
  assert.equal(confirmed.status, 422);
  assert.equal((await confirmed.json()).error, 'DOCUMENT_CRITICAL_CONFLICT');
  assert.equal(h.requests.length, 1); assert.deepEqual(h.writes, []);
});
