import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverDriverEarnings } from './driverEarningsDelivery.js';
const ids = { actor: '10000000-0000-0000-0000-000000000001', company: '00000000-0000-0000-0000-000000000001', driver: '20000000-0000-0000-0000-000000000001', delivery: '40000000-0000-0000-0000-000000000001' };
function fixture() {
  let saved = null;
  const calls = { uploads: 0, publishes: 0 };
  const actor = { id: ids.actor, company_id: ids.company, status: 'active', role: 'company_admin' };
  const options = {};
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ids.actor } } }) },
    from(_table) { return { select() { return this; }, eq() { return this; }, single: async () => ({ data: actor }), maybeSingle: async () => ({ data: saved }) }; },
    storage: { from(bucket) { assert.equal(bucket, 'driver-earnings'); return { upload: async (path, blob, config) => {
      calls.uploads++; assert.ok(path.includes(ids.driver)); assert.equal(config.upsert, false); assert.equal(blob.type, 'application/pdf'); return { error: options.uploadError };
    } }; } },
    rpc: async (name, payload) => {
      calls.publishes++; assert.equal(name, 'publish_driver_earnings');
      saved = { id: payload.p_id, company_id: ids.company, driver_id: payload.p_driver, sha256: payload.p_sha256,
        period_from: payload.p_period_from, period_to: payload.p_period_to, gross_cents: payload.p_gross_cents, net_cents: payload.p_net_cents };
      if (options.loseResponse) return { error: Error('response lost') };
      return { data: saved };
    },
  };
  const payload = { snapshot: { driver: { id: ids.driver }, deliveryId: ids.delivery, approvalStatus: 'approved', calculation: {
    gross: 850000, net: 721250, rows: [{ load: { driverId: ids.driver } }], period: { from: '2026-10-12', to: '2026-10-18' },
  } }, blob: new Blob(['%PDF-1.7 synthetic fixture'], { type: 'application/pdf' }), fileName: 'settlement.pdf' };
  return { client, payload, calls, actor, options };
}
test('send exact preview bytes and amounts once, including retry after a lost publish response', async () => {
  const f = fixture(); f.options.loseResponse = true;
  await assert.rejects(deliverDriverEarnings(f.client, f.payload), /response lost/);
  const receipt = await deliverDriverEarnings(f.client, f.payload);
  assert.equal(receipt.net_cents, 721250);
  assert.equal(receipt.driver_id, ids.driver);
  assert.deepEqual(f.calls, { uploads: 1, publishes: 1 });
});
test('demo, unapproved, mixed-driver and invalid money statements never upload', async () => {
  for (const edit of [s => { s.isDemo = true; }, s => { s.approvalStatus = 'draft'; }, s => { s.driver.id = 'demo-driver'; }, s => { s.calculation.net = -1; }, s => { s.calculation.rows[0].load.driverId = ids.actor; }]) {
    const f = fixture(); edit(f.payload.snapshot);
    await assert.rejects(deliverDriverEarnings(f.client, f.payload), /EARNINGS_INVALID/);
    assert.equal(f.calls.uploads, 0);
  }
});
test('non-admins are rejected and failed uploads never publish success', async () => {
  const f = fixture(); f.actor.role = 'dispatcher';
  await assert.rejects(deliverDriverEarnings(f.client, f.payload), /EARNINGS_PERMISSION_DENIED/);
  assert.equal(f.calls.uploads, 0);
  f.actor.role = 'company_admin'; f.options.uploadError = Error('offline');
  await assert.rejects(deliverDriverEarnings(f.client, f.payload), /offline/);
  assert.equal(f.calls.publishes, 0);
});
test('same delivery cannot silently replace different PDF bytes', async () => {
  const f = fixture(); await deliverDriverEarnings(f.client, f.payload);
  f.payload.blob = new Blob(['different PDF'], { type: 'application/pdf' });
  await assert.rejects(deliverDriverEarnings(f.client, f.payload), /EARNINGS_ID_CONFLICT/);
  assert.equal(f.calls.uploads, 1);
});
