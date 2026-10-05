import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedError } from './errors.js';

test('assigned PDF duplicate shows the existing-load message instead of a generic failure', () => {
  const t = key => key;
  assert.equal(localizedError(t,
    new Error('Yuk haydovchiga berilgan. Uning hujjatini avtomatik almashtirib bo‘lmaydi.'),
    'errors.createLoad'), 'importReview.duplicateLoad');
});
