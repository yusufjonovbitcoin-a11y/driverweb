import test from 'node:test';
import assert from 'node:assert/strict';
import { briefFieldLabel } from './driverBrief.js';

test('multi-stop review warnings use human-readable stop numbers and field names', () => {
  const t = (key, options = {}) => ({
    'driverBrief.stopNumber': `Stop ${options.number}`,
    'stopFields.addressLine': 'Address',
  })[key] ?? options.defaultValue ?? key;
  assert.equal(briefFieldLabel(t, 'stops.2.addressLine'), 'Stop 3 · Address');
});
