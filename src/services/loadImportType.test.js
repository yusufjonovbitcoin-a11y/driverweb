import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectedLoadImportType } from './loadImportType.js';
import { inspectLoadImportDocument, nativeLoadImportType, requireRateConClassification } from '../../supabase/functions/_shared/load-import-type.ts';

const source = (heading, quality = 'native') => ({ version: 1, checksum: 'hash', engine: 'test', pageCount: 1,
  pages: [{ number: 1, width: 612, height: 792, quality, blocks: [{ text: heading, bbox: [40, 30, 550, 50] }] }] });
const response = (type, confidence = .99) => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ type, confidence }) }] }] });
const options = (heading, request = async () => { throw Error('classification model must not run'); }) => {
  const pdf = source(heading);
  return { file: new File(['%PDF-1.7'], 'rate-confirmation.pdf', { type: 'application/pdf' }), bytes: new TextEncoder().encode('%PDF-1.7'),
    checksum: 'hash', model: 'test-model', parsePdf: async () => ({ source: pdf, partialSource: pdf, scanPages: [] }), request };
};

test('only explicit primary document headings are classified without AI', async () => {
  for (const heading of ['Rate Confirmation', 'Carrier Rate Confirmation #123', 'Load Confirmation', 'Carrier Confirmation']) {
    const result = await inspectLoadImportDocument(options(heading));
    assert.equal(result.classification.type, 'rate_confirmation');
    assert.equal(result.classification.method, 'native_heading');
    assert.ok(result.parsed);
  }
  for (const [heading, code] of [['BILL OF LADING', 'BOL'], ['STRAIGHT BILL OF LADING', 'BOL'],
    ['PROOF OF DELIVERY', 'POD'], ['Delivery Receipt', 'POD'], ['INVOICE', 'INVOICE'], ['Driver Sheet', 'DRIVER_SHEET']]) {
    await assert.rejects(inspectLoadImportDocument(options(heading)), new RegExp(`LOAD_IMPORT_TYPE_${code}`));
  }
});

test('filenames, incidental mentions and mixed headings cannot silently become Rate Con', () => {
  for (const title of ['Please submit the rate confirmation and POD.', 'Shipment 123', 'Bill to: Rate Confirmation Inc']) {
    assert.equal(nativeLoadImportType(source(title)), null);
  }
  const mixed = source('BILL OF LADING');
  mixed.pages[0].blocks.push({ text: 'Rate Confirmation', bbox: [40, 60, 550, 80] });
  assert.equal(nativeLoadImportType(mixed), null);
  assert.equal(nativeLoadImportType(source('Rate Confirmation', 'vision_required')), null);
  assert.throws(() => requireRateConClassification({ type: 'rate_confirmation' }), /UNKNOWN/);
});

test('ambiguous native PDF requests only a bounded type schema; rejection never returns extraction', async () => {
  let calls = 0;
  await assert.rejects(inspectLoadImportDocument(options('Shipment information', async body => {
    calls++;
    assert.equal(body.text.format.name, 'load_import_document_type');
    assert.deepEqual(body.text.format.schema.required, ['type', 'confidence']);
    assert.equal(body.input[0].content[0].type, 'input_text');
    assert.equal(body.store, false);
    return response('bol');
  })), /LOAD_IMPORT_TYPE_BOL/);
  assert.equal(calls, 1);
});

test('images/scans classify first and fail closed on uncertainty, malformed or incomplete output', async () => {
  for (const [result, code] of [[response('pod'), 'POD'], [response('rate_confirmation', .5), 'UNKNOWN'],
    [response('made_up'), 'UNKNOWN'], [{ status: 'incomplete' }, 'UNKNOWN'], [{ status: 'completed', output: [] }, 'UNKNOWN']]) {
    const setup = options('');
    setup.file = new File(['image'], 'rate.pdf.png', { type: 'image/png' });
    setup.parsePdf = async () => { throw Error('not a PDF'); };
    setup.request = async body => { assert.equal(body.input[0].content[0].type, 'input_image'); return result; };
    await assert.rejects(inspectLoadImportDocument(setup), new RegExp(`LOAD_IMPORT_TYPE_${code}`));
  }
  const setup = options('Unknown');
  setup.request = async () => response('rate_confirmation');
  assert.equal((await inspectLoadImportDocument(setup)).classification.method, 'ai_classification');
});

test('known rejection codes map to safe UI types; unrelated failures remain ordinary errors', () => {
  assert.equal(rejectedLoadImportType(new Error('LOAD_IMPORT_TYPE_BOL')), 'bol');
  assert.equal(rejectedLoadImportType({ code: 'LOAD_IMPORT_TYPE_DRIVER_SHEET' }), 'driver_sheet');
  assert.equal(rejectedLoadImportType(new Error('network error')), null);
});

test('gpt-5.4-mini classification uses model defaults instead of unsupported minimal reasoning', async () => {
  const setup = options('Shipment document', async body => {
    assert.equal(body.model, 'gpt-5.4-mini');
    assert.equal(body.reasoning, undefined);
    return response('rate_confirmation');
  });
  setup.model = 'gpt-5.4-mini';
  assert.equal((await inspectLoadImportDocument(setup)).classification.type, 'rate_confirmation');
});
