import { assertEquals } from 'jsr:@std/assert@1';
import { loadContactAccess } from './load-contact-access.ts';

Deno.test('contact access uses the authorized load predicate, including hidden-price loads', async () => {
  const client = { rpc(name: string, args: Record<string, unknown>) {
    assertEquals(name, 'can_access_load');
    assertEquals(args, { target_load_id: 'synthetic-load' });
    return Promise.resolve({ data: true, error: null });
  } };
  assertEquals(await loadContactAccess(client, 'synthetic-load'), 'allowed');
});

Deno.test('contact access denies false/null and fails closed on authorization errors', async () => {
  for (const data of [false, null, 'true']) {
    assertEquals(await loadContactAccess({ rpc: () => Promise.resolve({ data, error: null }) }, 'load'), 'denied');
  }
  assertEquals(await loadContactAccess({ rpc: () => Promise.resolve({ data: true, error: new Error('offline') }) }, 'load'), 'unavailable');
  assertEquals(await loadContactAccess({ rpc: () => Promise.reject(new Error('offline')) }, 'load'), 'unavailable');
});
