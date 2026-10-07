import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('experimental PDF demo has no header entry, module, or development proxy', () => {
  const header = source('src/components/TopHeader.jsx');
  assert.doesNotMatch(header, /PdfTextTest|pdfTestOpen|PDF text-only test/);
  assert.doesNotMatch(source('vite.config.js'), /pdf-text-test|127\.0\.0\.1:8789/);
  for (const path of [
    'src/components/PdfTextTest.jsx',
    'src/components/pdf-text-test.css',
    'src/services/pdfTextTestModel.js',
    'src/services/pdfTextTestModel.test.js',
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  assert.match(header, /onOpenCreateModal/);
});

test('ordinary PDF viewer assets and primary document parser remain connected', () => {
  const viewer = source('src/components/PdfDocumentViewer.jsx');
  assert.match(viewer, /from 'pdfjs-dist'/);
  assert.match(viewer, /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/);
  assert.match(source('vite.config.js'), /pdfAssets\(\)/);
  assert.match(source('src/services/operationsService.js'), /invokeAuthenticatedFunction\('parse-load-document', formData\)/);
  assert.ok(existsSync(new URL('../supabase/functions/parse-load-document/index.ts', import.meta.url)));
});
