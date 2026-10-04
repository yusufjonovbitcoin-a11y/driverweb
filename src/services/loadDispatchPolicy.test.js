import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchBlockingFields, dispatchWarningFields } from '../../supabase/functions/_shared/load-dispatch-policy.ts';

test('unverified non-route fields need acknowledgement but do not block dispatch', () => {
  const fields = ['isHazmat', 'billingEmail', 'requiredDocuments', 'pickup.contactPhone', 'stops.0.contactPhone'];
  assert.deepEqual(dispatchBlockingFields(fields), []);
  assert.deepEqual(dispatchWarningFields(fields), fields);
});

test('missing route essentials and unsupported stop workflow still block dispatch', () => {
  const fields = ['loadNumber', 'pickup.addressLine', 'stops.1.referenceNumber',
    'requirements.0', 'temperatureFahrenheit', 'multiStopDriverWorkflow', 'billingEmail'];
  assert.deepEqual(dispatchBlockingFields(fields), fields.slice(0, -1));
  assert.deepEqual(dispatchWarningFields(fields), ['billingEmail']);
});
