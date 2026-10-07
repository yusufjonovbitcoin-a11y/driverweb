import { assertEquals } from 'jsr:@std/assert@1';
import { loadAiConversationHistory, loadAiPresence } from './load-ai-context.ts';

Deno.test('current privacy removes previously authorized broker-rate conversation', () => {
  const history = [{ role: 'assistant', content: 'Earlier broker rate: $1234' }];
  assertEquals(loadAiConversationHistory({ broker_terms_hidden: true }, history), []);
  assertEquals(loadAiConversationHistory({ driver_pay: { amount: 100 } }, history), []);
  assertEquals(loadAiConversationHistory({ broker_terms_hidden: false }, history), history);
  assertEquals(loadAiConversationHistory({}, []), []);
});

Deno.test('AI context excludes stale GPS even with a new heartbeat', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const row = { is_online: true, last_seen_at: new Date(now).toISOString(),
    location_captured_at: new Date(now - 120_000).toISOString(), latitude: 40, longitude: -80 };
  assertEquals(loadAiPresence({ ...row, last_seen_at: new Date(now - 120_000).toISOString() }, now)?.is_online, false);
  assertEquals(loadAiPresence(row, now), { is_online: true, last_seen_at: row.last_seen_at });
  assertEquals(loadAiPresence({ ...row, location_captured_at: new Date(now - 10_000).toISOString() }, now)?.latitude, 40);
});
