import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizedError } from './errors.js';

test('original import upload failures explain retry without a duplicate load in every locale', () => {
  for (const locale of ['en', 'ru', 'uz']) {
    const catalog = JSON.parse(readFileSync(new URL(`./resources/${locale}.json`, import.meta.url), 'utf8'));
    const t = key => key.split('.').reduce((value, part) => value?.[part], catalog) || key;
    for (const code of ['IMPORT_DOCUMENT_UPLOAD_FAILED', 'IMPORT_DOCUMENT_PLAN_INVALID',
      'IMPORT_DOCUMENT_COMMIT_INVALID', 'STAFF_DOCUMENT_MANAGEMENT_REQUIRED']) {
      assert.equal(localizedError(t, new Error(code), 'errors.createLoad'), catalog.loadImport.sourceSaveFailed);
    }
    for (const code of ['IMPORT_DOCUMENT_CONFLICT', 'IMPORT_DOCUMENT_SOURCE_MISMATCH',
      'IMPORT_DOCUMENT_FILE_MISMATCH', 'IMPORT_DOCUMENT_LOAD_NOT_DRAFT']) {
      assert.equal(localizedError(t, new Error(code)), catalog.loadImport.sourceConflict);
    }
    assert.equal(localizedError(t, new Error('IMPORT_DOCUMENT_PERMISSION_DENIED')), catalog.errors.permission);
  }
});

test('trash conflict and authorization failures have actionable localized messages', () => {
  const t = key => key;
  for (const [message, key] of [
    ['LOAD_TRASH_CONFLICT', 'loadTrash.conflict'],
    ['LOAD_TRASH_NOT_FOUND', 'loadTrash.notFound'],
    ['LOAD_ALREADY_TRASHED', 'loadTrash.invalidState'],
    ['LOAD_NOT_TRASHED', 'loadTrash.invalidState'],
    ['LOAD_TRASHED', 'loadTrash.invalidState'],
    ['LOAD_TRASH_PERMISSION', 'errors.permission'],
    ['Driver not found or inactive', 'loadTrash.driverInvalid'],
  ]) assert.equal(localizedError(t, new Error(message)), key);
});

test('assigned PDF duplicate shows the existing-load message instead of a generic failure', () => {
  const t = key => key;
  assert.equal(localizedError(t,
    new Error('Yuk haydovchiga berilgan. Uning hujjatini avtomatik almashtirib bo‘lmaydi.'),
    'errors.createLoad'), 'importReview.duplicateLoad');
});

test('stale load document asks for a fresh upload in every supported language', () => {
  const error = new Error('LOAD_DOCUMENT_STALE');
  assert.equal(localizedError(key => key, error, 'errors.generic'), 'loadTrash.documentStale');
  for (const locale of ['en', 'ru', 'uz']) {
    const catalog = JSON.parse(readFileSync(new URL(`./resources/${locale}.json`, import.meta.url), 'utf8'));
    const t = key => key.split('.').reduce((value, part) => value?.[part], catalog) || key;
    const message = localizedError(t, error, 'errors.generic');
    assert.equal(message, catalog.loadTrash.documentStale, `${locale}: dedicated stale document translation`);
    assert.ok(message && message !== 'loadTrash.documentStale', `${locale}: actionable text instead of a raw key`);
  }
});

test('START address, handoff, update and settings errors are actionable in every locale', () => {
  for (const locale of ['en', 'ru', 'uz']) {
    const catalog = JSON.parse(readFileSync(new URL(`./resources/${locale}.json`, import.meta.url), 'utf8'));
    const t = key => key.split('.').reduce((value, part) => value?.[part], catalog) || key;
    for (const [code, key] of [['DRIVER_PAY_START_ADDRESS_REQUIRED', 'addressRequired'],
      ['DRIVER_PAY_HANDOFF_REQUIRES_REVIEW', 'handoffReview'], ['DRIVER_PAY_APP_UPDATE_REQUIRED', 'appUpdateRequired'],
      ['DRIVER_PAY_SETTINGS_UNAVAILABLE', 'settingsCheckError']]) {
      assert.equal(localizedError(t, new Error(code)), catalog.driverPay[key]);
    }
  }
});
