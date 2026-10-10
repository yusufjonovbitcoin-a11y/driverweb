// Offline compatibility check: no Gmail credentials, sockets, uploads or AI.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Buffer } from 'node:buffer';
import { createGmailSyncHandler } from '../supabase/functions/gmail-sync-worker/handler.mjs';

Deno.test('Deno can construct the pinned IMAP adapter without connecting', () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'fixture@example.invalid', pass: 'not-a-real-password' },
    logger: false, disableAutoIdle: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  if (typeof client.connect !== 'function') throw new Error('Missing IMAP adapter');
  client.close();
});

Deno.test('Deno parses synthetic MIME text and PDF bytes offline', async () => {
  const source = [
    'From: sender@example.invalid', 'To: receiver@example.invalid',
    'Subject: Offline compatibility fixture', 'Message-ID: <fixture@example.invalid>',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="fixture"', '',
    '--fixture', 'Content-Type: text/plain; charset=utf-8', '', 'Fixture body',
    '--fixture', 'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="fixture.pdf"',
    'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjcKJSVFT0Y=', '--fixture--', '',
  ].join('\r\n');
  const parsed = await simpleParser(Buffer.from(source), {
    skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true,
  });
  if (parsed.subject !== 'Offline compatibility fixture'
    || parsed.text?.trim() !== 'Fixture body'
    || parsed.attachments?.length !== 1
    || parsed.attachments[0].content.toString() !== '%PDF-1.7\n%%EOF') {
    throw new Error('MIME compatibility failed');
  }
});

Deno.test('Deno paused handler does not load runtime or create a DB client', async () => {
  const handler = createGmailSyncHandler({
    env: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'fixture-key' : undefined,
    createAdmin: () => { throw new Error('Paused worker accessed database'); },
    loadRuntime: () => { throw new Error('Paused worker loaded provider runtime'); },
  });
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-key' },
    body: JSON.stringify({ companyId: '11111111-1111-4111-8111-111111111111', action: 'run' }),
  }));
  const result = await response.json();
  if (response.status !== 200 || result.status !== 'paused' || result.executed !== false) {
    throw new Error('Paused guard failed');
  }
});
