import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageModuleLoadError } from './routeErrorModel.js';

test('runtime failures do not get mislabeled as an internet/module problem', () => {
  for (const error of [null, undefined, new TypeError("Cannot read properties of null (reading 'active')"), new Error('Render failed')]) {
    assert.equal(isPageModuleLoadError(error), false);
  }
});

test('known chunk and stylesheet load failures require a document reload', () => {
  for (const message of ['Failed to fetch dynamically imported module: /assets/map.js',
    'error loading dynamically imported module', 'Importing a module script failed.',
    'Loading chunk 4 failed.', 'Loading CSS chunk 4 failed.', 'Unable to preload CSS for /assets/map.css']) {
    assert.equal(isPageModuleLoadError(new Error(message)), true, message);
  }
  assert.equal(isPageModuleLoadError({ name: 'ChunkLoadError' }), true);
});
