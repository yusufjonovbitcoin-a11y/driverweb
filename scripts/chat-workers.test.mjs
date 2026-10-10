import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

// Execute the production handlers, replacing only external service boundaries.
async function workerCode(name) {
  const bundle = await rolldown({
    input: new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).pathname,
    plugins: [{
      name: 'isolated-worker-services',
      resolveId(id) {
        if (id.startsWith('https://esm.sh/')) return '\0client';
        if (id.endsWith('/fcm.ts')) return '\0fcm';
        if (id.endsWith('/rate-limit.ts')) return '\0rate';
      },
      load(id) {
        if (id === '\0client') return 'export const createClient=()=>{globalThis.serviceCalls.push("createClient");return globalThis.admin;};';
        if (id === '\0fcm') return 'export const parseFirebaseServiceAccount=()=>{globalThis.serviceCalls.push("parseFirebaseServiceAccount");return {};}; export const fetchFirebaseAccessToken=async()=>{globalThis.serviceCalls.push("fetchFirebaseAccessToken");return "test-token";}; export const sendFcmMessage=(...args)=>globalThis.sendFcm(...args);';
        if (id === '\0rate') return 'export const checkDistributedRateLimit=async()=>{globalThis.serviceCalls.push("checkDistributedRateLimit");return {allowed:true};}; export const rateLimitResponse=()=>new Response(null,{status:429});';
      },
    }],
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  return output[0].code;
}

const pushCode = await workerCode('process-push-notifications');
const mediaCode = await workerCode('process-media-deletions');
const delivery = { notification_id: 'n1', device_id: 'd1', company_id: 'c1', recipient_id: 'u1', push_token: 't1', title: 'stale title', body: 'stale text', notification_type: 'chat_message', entity_id: 'chat1', entity_type: 'chat_conversation', attempt_count: 1 };

function harness(code, { deleted = false, lookupError = false, jobs = [], env = {}, uploadEligible = true, body = {}, notification = {}, message = {}, device = { web_messages_enabled: true }, platform = 'web' } = {}) {
  const rpcs = [], updates = [], sends = [], removals = [], serviceCalls = [], selects = [];
  const environment = {
    SUPABASE_URL: 'https://test.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    PUSH_WORKER_TOKEN: 'test-push-worker',
    MEDIA_CLEANUP_WORKER_TOKEN: 'test-media-worker',
    ...env,
  };
  const rows = {
    push_deliveries: { status: 'processing', locked_by: 'edge-push-worker' },
    notifications: { type: 'chat_message', title: 'Current title', body: 'Edited text', chat_message_id: 'm1', created_at: new Date().toISOString(), read_at: null, ...notification },
    chat_messages: { deleted_at: deleted ? '2026-10-05T00:00:00Z' : null, read_at: null, ...message },
    push_devices: device,
  };
  const admin = {
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (name === 'claim_push_deliveries') return { data: [{ ...delivery, platform }], error: null };
      if (name === 'claim_jobs') return { data: jobs, error: null };
      if (name === 'can_cleanup_chat_upload') return { data: uploadEligible, error: null };
      return { data: name === 'cleanup_stale_chat_calls' ? 2 : true, error: null };
    },
    from(table) {
      let update;
      const filters = {};
      const query = {
        select(columns) { selects.push({ table, columns }); return query; },
        eq(key, value) { filters[key] = value; return query; },
        is(key, value) { filters[key] = value; return query; },
        update(value) { update = value; return query; },
        maybeSingle: async () => ({ data: rows[table], error: lookupError ? { message: 'unavailable' } : null }),
        then(resolve) { if (update) updates.push({ table, update, filters }); return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return query;
    },
    storage: { from: (bucket) => ({ remove: async (paths) => { removals.push({ bucket, paths: [...paths] }); return { error: null }; } }) },
  };
  let handler;
  const sandbox = {
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, AbortSignal, crypto,
    setTimeout, clearTimeout, admin, serviceCalls,
    sendFcm: async (...args) => { sends.push(args); return { ok: true, providerMessageId: 'fcm1' }; },
    Deno: { serve: (fn) => { handler = fn; }, env: { get: (key) => environment[key] } },
  };
  vm.runInNewContext(code, sandbox);
  return { rpcs, updates, sends, removals, serviceCalls, selects, run: (token = code === pushCode ? 'test-push-worker' : 'test-media-worker') => handler(new Request('https://test.invalid/worker', { method: 'POST', headers: token === null ? {} : { 'X-Worker-Token': token }, body: JSON.stringify(body) })) };
}

test('orphan worker refuses a referenced or unclaimed upload before Storage removal', async () => {
  const jobs = [{ id: 'job', company_id: 'company', payload: { provider: 'supabase_storage', chatUploadId: 'upload', bucket: 'chat-media', storagePath: 'company/conversation/op/file.pdf' } }];
  const h = harness(mediaCode, { jobs, uploadEligible: false });
  await h.run();
  assert.deepEqual(h.removals, []);
  assert.ok(h.rpcs.some((row) => row.name === 'dead_letter_job'));
  const safe = harness(mediaCode, { jobs });
  await safe.run();
  assert.equal(safe.removals.length, 1);
  assert.ok(safe.rpcs.some((row) => row.name === 'can_cleanup_chat_upload' && row.args.target_company_id === 'company'));
});

test('worker batch capacity is increased but bounded even for oversized input', async () => {
  for (const code of [pushCode, mediaCode]) {
    const h = harness(code, { body: { batchSize: 1000000 } }); await h.run();
    assert.equal(h.rpcs.find((row) => ['claim_jobs', 'claim_push_deliveries'].includes(row.name)).args.batch_size, 30);
  }
});

const workerAuthenticationCases = [
  { name: 'push', code: pushCode, workerKey: 'PUSH_WORKER_TOKEN', workerToken: 'test-push-worker', cronKey: 'PUSH_CRON_TOKEN', cronToken: 'test-push-cron', otherWorkerToken: 'test-media-worker', otherCronToken: 'test-media-cron' },
  { name: 'media', code: mediaCode, workerKey: 'MEDIA_CLEANUP_WORKER_TOKEN', workerToken: 'test-media-worker', cronKey: 'MEDIA_CLEANUP_CRON_TOKEN', cronToken: 'test-media-cron', otherWorkerToken: 'test-push-worker', otherCronToken: 'test-push-cron' },
];
const cronEnvironment = { PUSH_CRON_TOKEN: 'test-push-cron', MEDIA_CLEANUP_CRON_TOKEN: 'test-media-cron' };

function assertNoWorkerSideEffects(h) {
  assert.deepEqual(h.serviceCalls, []);
  assert.deepEqual(h.rpcs, []);
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.removals, []);
}

for (const worker of workerAuthenticationCases) {
  test(`${worker.name} worker continues accepting its existing token without a Cron token`, async () => {
    const h = harness(worker.code);
    assert.equal((await h.run(worker.workerToken)).status, 200);
    assert.ok(h.rpcs.length > 0);
  });

  for (const [kind, token] of [['existing', worker.workerToken], ['Cron', worker.cronToken]]) {
    test(`${worker.name} worker accepts its ${kind} token when both are configured`, async () => {
      const h = harness(worker.code, { env: cronEnvironment });
      assert.equal((await h.run(token)).status, 200);
      assert.ok(h.rpcs.length > 0);
    });
  }

  for (const unset of [undefined, '']) {
    test(`${worker.name} worker accepts a Cron token with ${unset === undefined ? 'missing' : 'empty'} existing token`, async () => {
      const h = harness(worker.code, { env: { ...cronEnvironment, [worker.workerKey]: unset } });
      assert.equal((await h.run(worker.cronToken)).status, 200);
      assert.ok(h.rpcs.length > 0);
    });
  }

  for (const [kind, token] of [['missing', null], ['empty', ''], ['wrong', 'wrong'], ['other worker', worker.otherWorkerToken], ['other worker Cron', worker.otherCronToken]]) {
    test(`${worker.name} worker rejects a ${kind} token before any service access`, async () => {
      const h = harness(worker.code, { env: cronEnvironment });
      assert.equal((await h.run(token)).status, 401);
      assertNoWorkerSideEffects(h);
    });
  }

  for (const [kind, env, token] of [
    ['unconfigured Cron', {}, worker.cronToken],
    ['empty Cron with an empty header', { [worker.cronKey]: '' }, ''],
    ['missing worker with an empty header', { ...cronEnvironment, [worker.workerKey]: undefined }, ''],
  ]) {
    test(`${worker.name} worker rejects ${kind} credentials before any service access`, async () => {
      const h = harness(worker.code, { env });
      assert.equal((await h.run(token)).status, 401);
      assertNoWorkerSideEffects(h);
    });
  }

  for (const unset of [undefined, '']) {
    test(`${worker.name} worker fails closed when both own tokens are ${unset === undefined ? 'missing' : 'empty'}`, async () => {
      const h = harness(worker.code, { env: { ...cronEnvironment, [worker.workerKey]: unset, [worker.cronKey]: unset } });
      assert.equal((await h.run(worker.otherCronToken)).status, 500);
      assertNoWorkerSideEffects(h);
    });
  }

  for (const service of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    test(`${worker.name} worker still requires ${service} with Cron authentication`, async () => {
      const h = harness(worker.code, { env: { ...cronEnvironment, [service]: undefined } });
      assert.equal((await h.run(worker.cronToken)).status, 500);
      assertNoWorkerSideEffects(h);
    });
  }
}

test('push worker cancels a deleted message instead of sending a stale claimed payload', async () => {
  const h = harness(pushCode, { deleted: true });
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cancelled, 1);
  assert.equal(h.sends.length, 0);
  assert.equal(h.updates[0].update.status, 'cancelled');
  assert.equal(h.updates[0].filters.locked_by, 'edge-push-worker');
  assert.equal(h.updates[0].filters.status, 'processing');
});

test('push worker uses the current notification and acknowledges only its own lease', async () => {
  const h = harness(pushCode);
  assert.equal((await (await h.run()).json()).completed, 1);
  assert.equal(h.sends[0][3].body, 'Edited text');
  assert.equal(h.sends[0][3].title, 'Current title');
  assert.equal(h.sends[0][4].conversationId, 'chat1');
  assert.equal(h.sends[0][4].entityId, 'chat1');
  assert.equal(h.sends[0][4].notificationId, 'n1');
  assert.equal(h.sends[0][4].recipient_id, 'u1');
  assert.equal(h.sends[0][4].recipientId, 'u1');
  assert.equal(h.sends[0][4].chat_message_id, 'm1');
  assert.equal(h.sends[0][4].chatMessageId, 'm1');
  assert.ok(Number.isFinite(Date.parse(h.sends[0][4].created_at)));
  assert.equal(h.sends[0][4].createdAt, h.sends[0][4].created_at);
  assert.ok(h.selects.some(({ table, columns }) => table === 'notifications' && columns.includes('created_at') && columns.includes('read_at')));
  assert.ok(h.selects.some(({ table, columns }) => table === 'chat_messages' && columns.includes('read_at')));
  const complete = h.rpcs.find((rpc) => rpc.name === 'complete_push_delivery');
  assert.equal(complete.args.worker_id, 'edge-push-worker');
});

for (const [reason, changes] of [
  ['read notification', { notification: { read_at: '2026-10-08T00:00:00Z' } }],
  ['read message', { message: { read_at: '2026-10-08T00:00:00Z' } }],
  ['chat older than one hour', { notification: { created_at: new Date(Date.now() - 3_601_000).toISOString() } }],
]) {
  test(`push worker cancels ${reason} without sending or deleting message history`, async () => {
    const h = harness(pushCode, changes);
    assert.equal((await (await h.run()).json()).cancelled, 1);
    assert.equal(h.sends.length, 0);
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].table, 'push_deliveries');
    assert.equal(h.updates[0].filters.notification_id, 'n1');
    assert.equal(h.updates[0].filters.device_id, 'd1');
    assert.equal(h.updates[0].filters.locked_by, 'edge-push-worker');
    assert.deepEqual(h.removals, []);
  });
}

test('push worker preserves old operational notifications', async () => {
  const h = harness(pushCode, { notification: { type: 'load_offer', chat_message_id: null, created_at: '2020-01-01T00:00:00Z' } });
  assert.equal((await (await h.run()).json()).completed, 1);
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0][4].chatMessageId, '');
});

test('web message delivery rechecks current category preference and missing endpoint before FCM', async () => {
  for (const device of [{ web_messages_enabled: false }, null]) {
    const h = harness(pushCode, { device });
    assert.equal((await (await h.run()).json()).cancelled, 1);
    assert.equal(h.sends.length, 0);
    assert.equal(h.updates[0].table, 'push_deliveries');
  }
  const native = harness(pushCode, { device: { web_messages_enabled: false }, platform: 'android' });
  assert.equal((await (await native.run()).json()).completed, 1);
  const operational = harness(pushCode, { device: { web_messages_enabled: false }, notification: { type: 'load_offer', chat_message_id: null } });
  assert.equal((await (await operational.run()).json()).completed, 1);
});

test('push eligibility lookup failure retries without leaking stale content to FCM', async () => {
  const h = harness(pushCode, { lookupError: true });
  assert.equal((await (await h.run()).json()).failed, 1);
  assert.equal(h.sends.length, 0);
  assert.equal(h.rpcs.find((rpc) => rpc.name === 'fail_push_delivery').args.retryable, true);
});

test('media worker handles a queued chat deletion and runs bounded call maintenance', async () => {
  const path = 'company/conversation/client/file.pdf';
  const h = harness(mediaCode, { jobs: [{ id: 'j1', company_id: 'company', payload: { provider: 'supabase_storage', messageId: 'm1', bucket: 'chat-media', storagePath: path } }] });
  const response = await h.run();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.completed, 1);
  assert.equal(result.maintenance.staleCalls, 2);
  assert.deepEqual(h.removals, [{ bucket: 'chat-media', paths: [path] }]);
  assert.equal(h.rpcs.find((rpc) => rpc.name === 'cleanup_stale_chat_calls').args.batch_size, 100);
  assert.equal(h.rpcs.find((rpc) => rpc.name === 'complete_job').args.job_id, 'j1');
});

test('media worker refuses mismatched chat cleanup bucket before deleting a file', async () => {
  const h = harness(mediaCode, { jobs: [{ id: 'j1', company_id: 'company', payload: { provider: 'supabase_storage', messageId: 'm1', bucket: 'load-documents', storagePath: 'c/chat/id/file.pdf' } }] });
  assert.equal((await (await h.run()).json()).failed, 1);
  assert.equal(h.removals.length, 0);
  assert.ok(h.rpcs.some((rpc) => rpc.name === 'dead_letter_job'));
});
