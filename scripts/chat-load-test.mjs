// Explicit staging-only load runner. Never use production user tokens.
// CHAT_LOAD_URL, CHAT_LOAD_ANON_KEY, CHAT_LOAD_ACCOUNTS=/private/accounts.json
// accounts: [{ userId, accessToken, conversationId }] (one account per simulated client).
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const url = process.env.CHAT_LOAD_URL;
if (process.env.CHAT_LOAD_ENV !== 'staging' || !url || url.includes('gsnbjpqwwpvqtmphsyfs')) {
  throw new Error('Use a separate staging project and explicitly set CHAT_LOAD_ENV=staging. Production is blocked.');
}
const accounts = JSON.parse(await readFile(process.env.CHAT_LOAD_ACCOUNTS, 'utf8'));
const sizes = (process.env.CHAT_LOAD_CLIENTS || '25,50,100,150').split(',').map(Number);
if (sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 150 || n > accounts.length)) throw new Error('Provide a distinct staging account for each client (maximum 150).');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const size of sizes) {
  const latencies = []; let errors = 0; let connected = 0;
  const clients = accounts.slice(0, size).map((account) => ({ account, client: createClient(url, process.env.CHAT_LOAD_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${account.accessToken}` } },
  }) }));
  try {
    await Promise.all(clients.map(async ({ client, account }) => {
      await client.realtime.setAuth(account.accessToken);
      await new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); if (ok) connected++; else errors++; resolve(); };
        const timer = setTimeout(() => finish(false), 15000);
        client.channel(`load:${crypto.randomUUID()}`).on('postgres_changes', {
          event: '*', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${account.conversationId}`,
        }, () => {}).subscribe((status) => {
          if (status === 'SUBSCRIBED') finish(true);
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') finish(false);
        });
      });
      // Read-only: measures connections/history/summary under concurrent load, not delivery latency.
      for (let iteration = 0; iteration < 10; iteration++) {
        const start = performance.now();
        const results = await Promise.all([
          client.rpc('get_chat_unread_summary'),
          client.rpc('get_chat_sync_page', { target_conversation_id: account.conversationId }),
        ]);
        latencies.push(performance.now() - start);
        errors += results.filter((result) => result.error).length;
        await sleep(2000);
      }
    }));
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ clients: size, connected, requests: size * 20, errors,
      p50_ms: Math.round(latencies[Math.floor(latencies.length * .5)]), p95_ms: Math.round(latencies[Math.floor(latencies.length * .95)]) }));
    if (errors) { process.exitCode = 1; break; }
  } finally { await Promise.all(clients.map(({ client }) => client.removeAllChannels())); }
}
