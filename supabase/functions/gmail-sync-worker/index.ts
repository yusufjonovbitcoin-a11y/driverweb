import { createClient } from '@supabase/supabase-js';
import { createGmailSyncHandler } from './handler.mjs';

const handler = createGmailSyncHandler({
  env: (name: string) => Deno.env.get(name),
  createAdmin: (url: string, key: string) => createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const signals = [AbortSignal.timeout(15_000)];
        if (init?.signal) signals.push(init.signal);
        if (input instanceof Request) signals.push(input.signal);
        return fetch(input, { ...init, signal: AbortSignal.any(signals) });
      },
    },
  }),
  // Paused invocations never import/instantiate IMAP or fetch mailbox secrets.
  loadRuntime: async () => {
    const [{ runGmailSync }, { ImapFlow }, { simpleParser }, { Buffer }] = await Promise.all([
      import('./runtime.mjs'), import('imapflow'), import('mailparser'), import('node:buffer'),
    ]);
    return {
      runGmailSync,
      dependencies: {
        createImapClient: (options: Record<string, unknown>) => new ImapFlow(options),
        parseMail: (source: Uint8Array, options: Record<string, unknown>) => simpleParser(Buffer.from(source), options),
        fetch,
        now: Date.now,
      },
    };
  },
});

Deno.serve(handler);
