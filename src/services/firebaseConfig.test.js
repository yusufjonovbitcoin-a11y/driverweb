import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firebaseConfig, firebaseVapidKey, getFirebaseApp } from './firebaseConfig.js';

test('Firebase requires external configuration without a hardcoded fallback', async () => {
  assert.equal(firebaseConfig.apiKey, '');
  assert.equal(firebaseVapidKey, '');
  await assert.rejects(getFirebaseApp(), /configuration is missing/);
});

test('Firebase module contains env references, not literal Google or VAPID keys', () => {
  const source = readFileSync(new URL('./firebaseConfig.js', import.meta.url), 'utf8');
  assert.match(source, /VITE_FIREBASE_API_KEY/);
  assert.match(source, /VITE_FIREBASE_VAPID_KEY/);
  assert.doesNotMatch(source, /AIza[\w-]{30,}/);
  assert.doesNotMatch(source, /firebaseVapidKey\s*=\s*['"][\w-]{50,}/);
});
