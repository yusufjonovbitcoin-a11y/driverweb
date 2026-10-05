import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

const bundle = await rolldown({ input: new URL('../src/services/operationsService.js', import.meta.url).pathname,
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
    offers: [], assignments: [], warnings: [], driver_presence: [], document_review_overview: [],
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
