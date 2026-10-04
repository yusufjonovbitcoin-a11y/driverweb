import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractCloudPdfSource } from '../../supabase/functions/_shared/pdf-cloud-source.ts';
import { evidenceFromSource } from '../../supabase/functions/_shared/pdf-source.ts';

const loadPdf = () => import('unpdf');
const checksum = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

test('Edge PDF parser binds visible facts to real native text and positions', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('LOAD NO: TEST-42', { x: 40, y: 740, size: 12, font });
  page.drawText('TOTAL RATE $1,000.00', { x: 40, y: 710, size: 12, font });
  const bytes = await pdf.save();
  const digest = await checksum(bytes);
  const result = await extractCloudPdfSource(bytes, digest, loadPdf);
  assert.deepEqual(result.scanPages, []);
  assert.equal(result.source.checksum, digest);
  const loadLine = result.source.pages[0].blocks.find(block => block.text.includes('TEST-42'));
  assert.ok(loadLine);
  assert.ok(loadLine.bbox[0] >= 39 && loadLine.bbox[3] < 100);
  const evidence = evidenceFromSource([loadLine.id], result.source, 'loadNumber');
  assert.match(evidence.quote, /TEST-42/);
  assert.equal(evidence.sourceChecksum, digest);
});

test('a scanned page cannot claim independent text grounding', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const result = await extractCloudPdfSource(bytes, await checksum(bytes), loadPdf);
  assert.equal(result.source, null);
  assert.deepEqual(result.scanPages, [1]);
});
