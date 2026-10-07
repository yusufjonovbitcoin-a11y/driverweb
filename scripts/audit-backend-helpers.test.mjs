import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAiConversationHistory, loadAiPresence } from '../supabase/functions/_shared/load-ai-context.ts';
import { loadContactAccess } from '../supabase/functions/_shared/load-contact-access.ts';

test('manual privacy and fixed-pay both discard previous broker-rate AI answers', () => {
  const history = [{ role: 'assistant', content: 'Earlier broker rate $1234' }];
  assert.deepEqual(loadAiConversationHistory({ broker_terms_hidden: true }, history), []);
  assert.deepEqual(loadAiConversationHistory({ driver_pay: { amount: 42 } }, history), []);
  assert.deepEqual(loadAiConversationHistory({ broker_terms_hidden: false }, history), history);
});

test('contact authorization uses the load predicate and fails closed on errors', async () => {
  for (const [data, error, expected] of [[true,null,'allowed'],[false,null,'denied'],[null,null,'denied'],['true',null,'denied'],[true,{},'unavailable']]) {
    const client = { rpc: async (name,args) => {
      assert.equal(name,'can_access_load'); assert.deepEqual(args,{target_load_id:'synthetic-load'});
      return {data,error};
    } };
    assert.equal(await loadContactAccess(client,'synthetic-load'),expected);
  }
  assert.equal(await loadContactAccess({ rpc: async () => { throw new Error('offline'); } },'load'),'unavailable');
});


test('AI context cannot mistake a heartbeat for a fresh GPS capture', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const row = { is_online: true, last_seen_at: new Date(now).toISOString(),
    location_captured_at: new Date(now - 10_000).toISOString(), latitude: 40, longitude: -80 };
  assert.equal(loadAiPresence(row, now).latitude, 40);
  assert.equal(loadAiPresence(row, now).location_captured_at, row.location_captured_at);
  for (const sample of [undefined, new Date(now - 120_000).toISOString(), new Date(now + 31_000).toISOString()]) {
    const context = loadAiPresence({ ...row, location_captured_at: sample }, now);
    assert.equal(context.latitude, undefined);
    assert.equal(context.longitude, undefined);
    assert.equal(context.last_seen_at, row.last_seen_at);
  }
  assert.equal(loadAiPresence({ ...row, is_online: false }, now).latitude, undefined);
  for (const heartbeat of [undefined, new Date(now - 120_000).toISOString(), new Date(now + 31_000).toISOString()]) {
    const context = loadAiPresence({ ...row, last_seen_at: heartbeat }, now);
    assert.equal(context.is_online, false);
    assert.equal(context.latitude, undefined);
  }
});
