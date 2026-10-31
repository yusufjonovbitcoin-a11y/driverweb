import test from 'node:test';
import assert from 'node:assert/strict';
import { loadIdentity } from './loadIdentity.js';

test('internal number is primary and a repeated broker reference stays independent', () => {
  const a = loadIdentity({ internal_number: 100, load_number: '38594033' });
  const b = loadIdentity({ internal_number: 101, load_number: '38594033' });
  assert.equal(a.loadNumber, '#100'); assert.equal(b.loadNumber, '#101');
  assert.equal(a.brokerLoadNumber, b.brokerLoadNumber);
  assert.deepEqual(loadIdentity(a), a);
});
test('legacy rows keep their reference; missing references never invent a number', () => {
  assert.equal(loadIdentity({ load_number: '#LEGACY' }).loadNumber, '#LEGACY');
  assert.deepEqual(loadIdentity({ internal_number: '999' }), { internalNumber: '999', loadNumber: '#999', brokerLoadNumber: null });
  assert.equal(loadIdentity({ internal_number: 1000 }).loadNumber, '#1000');
  for (const invalid of [-1, 0, 99, NaN, '100.1']) assert.equal(loadIdentity({ internal_number: invalid }).internalNumber, null);
  assert.equal(loadIdentity({}).loadNumber, '—');
});
