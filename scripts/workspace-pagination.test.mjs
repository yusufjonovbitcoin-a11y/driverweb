import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

const bundle = await rolldown({ input: fileURLToPath(new URL('../src/services/operationsService.js', import.meta.url)),
  plugins: [{ name: 'isolated-workspace', resolveId(id) {
    if (id.endsWith('/lib/supabase')) return '\0client';
    if (id.endsWith('/workspaceMediaResolver')) return '\0media';
  }, load(id) {
    if (id === '\0client') return 'export const requireSupabase=()=>globalThis.workspaceTestClient; export const supabaseUrl="https://test.invalid";export const supabaseAnonKey="test";';
    if (id === '\0media') return 'export async function resolveProfileAvatarUrls(){throw new Error("Core workspace must not await media");}';
  } }] });
const { output } = await bundle.generate({ format: 'esm' }); await bundle.close();
const { fetchWorkspace, subscribeWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);

test('workspace retains 1205 drivers/loads and all associated documents beyond API cap', async () => {
  const ids = Array.from({ length: 1205 }, (_, n) => String(n).padStart(5, '0'));
  const tables = {
    member_directory: ids.map(id => ({ id, full_name: `Driver ${id}`, role: 'driver', status: 'active', avatar_path: `avatars/${id}` })),
    load_overview: ids.map(id => ({ id, load_number: id, status: 'draft', updated_at: '2026-10-05' })),
    documents: ids.map(id => ({ id, load_id: id, document_type: 'rate_confirmation', current_version_id: `version-${id}` })),
    offers: [], assignments: [], warnings: [], driver_presence: [], document_review_overview: [], assignment_driver_pay: [],
  };
  globalThis.workspaceTestClient = { from(table) {
    let rows = tables[table], key = 'id', cursor = null;
    return { select() { return this; }, eq() { return this; }, order(value) { key = value; return this; }, limit() { return this; },
      gt(_, value) { cursor = value; return this; }, range() { return this; },
      then(resolve) { resolve({ data: rows.filter(row => cursor === null || row[key] > cursor).slice(0, 250) }); } };
  } };
  const result = await fetchWorkspace();
  assert.equal(result.drivers.length, 1205);
  assert.equal(result.loads.length, 1205);
  assert.equal(new Set(result.drivers.map(row => row.id)).size, 1205);
  assert.equal(result.loads[0].documentMeta.rateCon.current_version_id, `version-${result.loads[0].id}`);
  assert.equal(result.drivers[0].avatar, null);
  assert.equal(result.drivers[0].avatarPath, `avatars/${result.drivers[0].id}`);
  delete globalThis.workspaceTestClient;
});

test('presence realtime dispatch bypasses whole-workspace refresh', () => {
  const listeners = new Map(); let full = 0, presence = 0;
  const channel = { on(_, filter, callback) { listeners.set(filter.table, callback); return this; }, subscribe() { return this; } };
  globalThis.workspaceTestClient = { channel: () => channel, removeChannel() {} };
  const unsubscribe = subscribeWorkspace(() => { full++; }, () => { presence++; });
  listeners.get('driver_presence')({ new: { driver_id: 'a' } });
  assert.equal(presence, 1); assert.equal(full, 0);
  unsubscribe(); delete globalThis.workspaceTestClient;
});

function progressiveClient({ reviews, coreFailure = false, coreDelay = 0 }) {
  const tables = {
    load_overview: [{ id: 'load', load_number: '101', status: 'draft' }],
    member_directory: [{ id: 'driver', role: 'driver', status: 'active', full_name: 'Driver' }],
    documents: [{ id: 'doc', load_id: 'load', document_type: 'bol', current_version_id: 'v1' }],
  };
  return { from(table) {
    let cursor = null, offset = 0;
    return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      gt(_, value) { cursor = value; return this; }, range(value) { offset = value; return this; },
      async then(resolve, reject) {
        try {
          if (table === 'document_review_overview') {
            const rows = await reviews;
            resolve({ data: offset ? [] : rows });
          } else {
            if (coreDelay) await new Promise(done => setTimeout(done, coreDelay));
            resolve(coreFailure && table === 'load_overview' ? { error: new Error('core unavailable') }
              : { data: cursor ? [] : tables[table] || [] });
          }
        } catch (error) { reject(error); }
      } };
  } };
}

test('core workspace renders while reviews are pending, then includes their actual warnings', async () => {
  const reviews = Promise.withResolvers(), core = Promise.withResolvers();
  globalThis.workspaceTestClient = progressiveClient({ reviews: reviews.promise });
  let finished = false;
  const pending = fetchWorkspace({ onCoreReady: core.resolve }).then(value => { finished = true; return value; });
  const early = await core.promise;
  assert.equal(finished, false);
  assert.equal(early.drivers[0].name, 'Driver');
  assert.equal(early.loads[0].documentReviewsStatus, 'loading');
  assert.equal(early.loads[0].documentChecks.shipperBol, null);
  assert.equal(early.loads[0].documentMeta.shipperBol.current_version_id, 'v1');
  const review = { document_id: 'doc', check_id: 'check', check_status: 'failed', active_warnings: [{ code: 'signature_missing' }] };
  reviews.resolve([review]);
  const final = await pending;
  assert.equal(final.loads[0].documentReviewsStatus, 'ready');
  assert.deepEqual(final.loads[0].documentChecks.shipperBol, review);
  delete globalThis.workspaceTestClient;
});

test('review failure preserves usable core data and declares review status unavailable', async () => {
  const reviews = Promise.withResolvers(), core = Promise.withResolvers(), updates = [];
  globalThis.workspaceTestClient = progressiveClient({ reviews: reviews.promise });
  const pending = fetchWorkspace({ onCoreReady: snapshot => { updates.push(snapshot); core.resolve(); } });
  const failure = assert.rejects(pending, /review unavailable/);
  await core.promise;
  reviews.reject(new Error('review unavailable'));
  await failure;
  assert.deepEqual(updates.map(value => value.loads[0].documentReviewsStatus), ['loading', 'error']);
  assert.equal(updates[1].drivers.length, 1);
  delete globalThis.workspaceTestClient;
});

test('core failure never publishes an incomplete roster even if reviews also fail', async () => {
  globalThis.workspaceTestClient = progressiveClient({ reviews: Promise.reject(new Error('review unavailable')), coreFailure: true });
  let published = false;
  await assert.rejects(fetchWorkspace({ onCoreReady: () => { published = true; } }), /core unavailable/);
  assert.equal(published, false);
  delete globalThis.workspaceTestClient;
});

test('callers without progressive rendering still await complete document reviews', async () => {
  const reviews = Promise.withResolvers();
  globalThis.workspaceTestClient = progressiveClient({ reviews: reviews.promise });
  let finished = false;
  const pending = fetchWorkspace().then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  reviews.resolve([]);
  assert.equal((await pending).loads[0].documentReviewsStatus, 'ready');
  delete globalThis.workspaceTestClient;
});
