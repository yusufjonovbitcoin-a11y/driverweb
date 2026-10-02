import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImportFileError, MAX_LOAD_IMPORT_BYTES } from './loadImportFile.js';

test('load import accepts the PDF and image formats supported by the server', () => {
  for (const [name, type] of [
    ['rate.pdf', 'application/pdf'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
  ]) {
    assert.equal(loadImportFileError({ name, type, size: 100 }), null);
  }
});

test('load import rejects unsupported, mismatched, empty, and oversized files', () => {
  assert.equal(loadImportFileError({ name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 100 }), 'fileRequired');
  assert.equal(loadImportFileError({ name: 'fake.pdf', type: 'image/png', size: 100 }), 'fileRequired');
  assert.equal(loadImportFileError({ name: 'empty.pdf', type: 'application/pdf', size: 0 }), 'fileRequired');
  assert.equal(loadImportFileError({ name: 'large.pdf', type: 'application/pdf', size: MAX_LOAD_IMPORT_BYTES + 1 }), 'fileTooLarge');
});
