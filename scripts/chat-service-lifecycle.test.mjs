import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: fileURLToPath(new URL('../src/services/chatService.js', import.meta.url)),
  plugins: [{ name: 'isolated-chat-client', resolveId(id) { if (id.endsWith('/lib/supabase')) return '\0fixture-client'; }, load(id) {
    if (id === '\0fixture-client') return "export const requireSupabase=()=>globalThis.chatLifecycleTestClient; export const supabaseUrl='https://fixture.invalid'; export const supabaseAnonKey='synthetic-public';";
  } }],
});
const { output } = await bundle.generate({ format: 'esm' }); await bundle.close();
const service = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);

test('real service shares subscribers, but remount before async unsubscribe gets a fresh channel', () => {
  const channels = new Map(); const removed = [];
  globalThis.chatLifecycleTestClient = {
    channel(topic) {
      if (channels.has(topic)) return channels.get(topic);
      const channel = { subscribed: false, on() { assert.equal(this.subscribed, false, 'SDK forbids adding handlers after subscribe'); return this; }, subscribe() { this.subscribed = true; return this; } };
      channels.set(topic, channel); return channel;
    },
    // Keep old channel registered to reproduce Supabase's async unsubscribe.
    removeChannel(channel) { removed.push(channel); return Promise.resolve(); },
  };
  const offA = service.subscribeChatPreviews(() => {});
  const offB = service.subscribeUnreadChats(() => {});
  assert.equal(channels.size, 1);
  offA(); offA(); assert.equal(removed.length, 0);
  offB(); assert.equal(removed.length, 1);
  const offC = service.subscribeChatPreviews(() => {});
  assert.equal(channels.size, 2); offC(); assert.equal(removed.length, 2);
  delete globalThis.chatLifecycleTestClient;
});
