import test from 'node:test';
import assert from 'node:assert/strict';
import { runGmailSync, MAX_SOURCE_BYTES } from './runtime.mjs';

const source = new TextEncoder().encode('From: broker@example.test\r\n\r\nhello');
function harness(options = {}) {
  const calls = [];
  const rows = { broker_messages: [], broker_attachments: [], ai_extractions: [], jobs: [], ...options.rows };
  let valid = true;
  let sequence = 0;
  const connection = { connection_id: 'connection', configuration_version: 3, provider_history_id: '10', uid_validity: '100', ...options.connection };
  const credentials = { connection_id: 'connection', configuration_version: 3,
    mailbox_email: 'mailbox@example.test', app_password: 'test-not-a-secret', ...options.credentials };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = Infinity; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    is(key, value) { this.filters.push(row => value === null ? row[key] == null : row[key] === value); return this; }
    not(key, _op, value) { this.filters.push(row => row[key] !== value && row[key] !== undefined); return this; }
    or() { return this; }
    order() { return this; }
    range(start, end) { this.start = start; this.end = end + 1; return this; }
    limit(limit) { this.end = limit; return this; }
    maybeSingle() { this.single = true; return this; }
    abortSignal() { return this; }
    update(values) { this.updateValue = values; return this; }
    upsert(values) { this.insertValue = values; return this; }
    then(resolve, reject) {
      try {
        const table = rows[this.table] ||= [];
        let selected = table.filter(row => this.filters.every(filter => filter(row))).slice(this.start, this.end);
        if (this.updateValue) {
          calls.push(['write', this.table]);
          for (const row of selected) Object.assign(row, this.updateValue);
        }
        if (this.insertValue) {
          calls.push(['write', this.table]);
          if (!table.some(row => row.message_id === this.insertValue.message_id && row.checksum_sha256 === this.insertValue.checksum_sha256))
            table.push({ id: `id-${++sequence}`, ...this.insertValue });
        }
        return Promise.resolve({ data: this.single ? selected[0] || null : selected, error: null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  const admin = {
    from(table) { return new Query(table); },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (options.rpc) { const result = await options.rpc(name, args); if (result !== undefined) return result; }
      if (name === 'assert_gmail_cloud_worker') return { data: { status: options.guardStatus || (valid ? 'valid' : 'lost') } };
      if (name === 'get_gmail_worker_credentials') return { data: [credentials] };
      if (name === 'ingest_broker_message_guarded') {
        let row = rows.broker_messages.find(row => row.provider_message_id === args.provider_message_id);
        if (!row) {
          row = { id: `message-${++sequence}`, company_id: 'company', ...args };
          rows.broker_messages.push(row);
        }
        return { data: row.id };
      }
      if (name === 'checkpoint_gmail_cloud_worker') return { data: { status: options.checkpointStatus || 'checkpointed' } };
      if (name === 'recover_gmail_cloud_label_jobs') return { data: { status: 'recovered', count: 0 } };
      if (name === 'select_gmail_cloud_pending_attachments') return { data: { status: 'selected', attachments:
        rows.broker_attachments.filter(row => {
          const message = rows.broker_messages.find(message => message.id === row.message_id);
          return message?.gmail_connection_id === 'connection' && message.status !== 'needs_review'
            && !rows.ai_extractions.some(extraction => extraction.attachment_id === row.id && ['extracted', 'needs_review'].includes(extraction.status));
        }).slice(0, 1) } };
      if (name === 'claim_company_gmail_label_jobs') return { data: rows.jobs.slice(0, 1) };
      return { data: null };
    },
  };
  const parsed = { messageId: '<message@example.test>', date: new Date('2026-10-08T00:00:00Z'),
    text: 'hello', from: { value: [{ address: 'broker@example.test' }] },
    attachments: [{ filename: 'rate.pdf', contentType: 'application/pdf', content: new TextEncoder().encode('%PDF-test') }],
    ...options.parsed };
  const imap = {
    mailbox: { uidValidity: 100n, uidNext: 13, ...options.mailbox },
    on() {},
    async connect() { calls.push(['connect']); },
    async getMailboxLock() { return { release() { calls.push(['unlock']); } }; },
    async search() { calls.push(['search']); return options.uids || [12, 11]; },
    async fetchOne(uid, fields) {
      calls.push(['fetch', fields.source ? 'source' : 'metadata']);
      return fields.source ? { uid, source: options.source || source, envelope: {} }
        : { uid, size: options.advertisedSize ?? source.byteLength };
    },
    async logout() { calls.push(['logout']); if (options.hangingLogout) await new Promise(() => {}); },
    close() { calls.push(['close']); },
    async mailboxCreate(label) { calls.push(['label', label]); },
  };
  const deps = {
    createImapClient(config) { calls.push(['client', config]); return imap; },
    async parseMail(bytes, config) {
      calls.push(['parse', bytes.length, config]);
      if (options.parse) return await options.parse({ loseLease: () => { valid = false; }, parsed, bytes, parseOptions: config });
      return parsed;
    },
    async fetch(url, init) {
      const name = String(url).split('/').at(-1); calls.push(['http', name]);
      if (options.fetch) return await options.fetch({ name, url: String(url), init, loseLease: () => { valid = false; } });
      return new Response(JSON.stringify(name === 'cloudinary-media' ? { reference: 'cloudinary:test' } : { status: 'extracted' }));
    },
  };
  const config = { admin, companyId: 'company', leaseOwner: 'owner', connection,
    workerToken: 'test-worker', supabaseUrl: 'https://project.example', serviceRoleKey: 'test-admin', maxRunMs: options.maxRunMs || 90_000 };
  return { calls, rows, config, deps, run: () => runGmailSync(config, deps) };
}
const called = (h, type, name) => h.calls.filter(call => call[0] === type && (name === undefined || call[1] === name));

test('module import does not perform network calls', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('network prohibited'); };
  try { await import(`./runtime.mjs?inert=${Date.now()}`); assert.equal(calls, 0); }
  finally { globalThis.fetch = previous; }
});

test('lost lease stops before credentials, IMAP construction or network', async () => {
  const h = harness({ guardStatus: 'lost' });
  await assert.rejects(h.run(), { code: 'GMAIL_LEASE_LOST' });
  assert.equal(called(h, 'rpc', 'get_gmail_worker_credentials').length, 0);
  assert.equal(called(h, 'client').length, 0); assert.equal(called(h, 'http').length, 0);
});

test('credentials must match connection, company and configuration snapshot', async () => {
  for (const credentials of [{ connection_id: 'foreign' }, { company_id: 'other' }, { configuration_version: 4 }]) {
    const h = harness({ credentials });
    await assert.rejects(h.run(), { code: 'GMAIL_CREDENTIAL_SCOPE_MISMATCH' });
    assert.equal(called(h, 'client').length, 0);
  }
});

test('one ordered message, verified TLS, bounded parser, and successful checkpoint', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.synced, 1); assert.equal(result.documents, 1); assert.equal(result.processed, 1);
  assert.equal(called(h, 'fetch', 'source').length, 1);
  const options = called(h, 'client')[0][1];
  assert.equal(options.host, 'imap.gmail.com'); assert.equal(options.port, 993); assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.logger, false);
  assert.equal(called(h, 'parse')[0][2].skipHtmlToText, true);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker')[0][2].p_last_uid, 11);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker')[0][2].p_uid_validity, '100');
  assert.equal(called(h, 'close').length, 1);
});

test('oversized advertised source is rejected before source fetch and parsing', async () => {
  const h = harness({ advertisedSize: MAX_SOURCE_BYTES + 1 });
  await assert.rejects(h.run(), { code: 'GMAIL_SOURCE_TOO_LARGE' });
  assert.equal(called(h, 'fetch', 'source').length, 0); assert.equal(called(h, 'parse').length, 0);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker').length, 0);
});

test('actual source length is checked even if advertised size lies', async () => {
  const h = harness({ source: new Uint8Array(MAX_SOURCE_BYTES + 1) });
  await assert.rejects(h.run(), { code: 'GMAIL_SOURCE_TOO_LARGE' });
  assert.equal(called(h, 'parse').length, 0); assert.equal(called(h, 'http').length, 0);
});

test('UIDVALIDITY absent or changed blocks provider writes and checkpoint', async () => {
  const h = harness({ mailbox: { uidValidity: null } });
  await assert.rejects(h.run(), { code: 'GMAIL_UID_INVALID' });
  assert.equal(called(h, 'http').length, 0);
  const unverified = harness({ guardStatus: 'uid_validity_unverified' });
  await assert.rejects(unverified.run(), { code: 'GMAIL_UIDVALIDITY_UNVERIFIED' });
});

test('lease lost during parsing prevents upload, ingestion and checkpoint', async () => {
  const h = harness({ parse: ({ loseLease, parsed }) => { loseLease(); return parsed; } });
  await assert.rejects(h.run(), { code: 'GMAIL_LEASE_LOST' });
  assert.equal(called(h, 'http').length, 0); assert.equal(called(h, 'write').length, 0);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker').length, 0);
});

test('lease lost during upload blocks subsequent database mutation and AI', async () => {
  const h = harness({ fetch: ({ loseLease }) => { loseLease(); return new Response('{"reference":"cloudinary:test"}'); } });
  await assert.rejects(h.run(), { code: 'GMAIL_LEASE_LOST' });
  assert.equal(called(h, 'rpc', 'ingest_broker_message_guarded').length, 0);
  assert.equal(called(h, 'http', 'process-broker-attachment').length, 0);
});

test('retry uses durable message and attachment before upload, completed AI is not rerun', async () => {
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('%PDF-test')))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const h = harness({ rows: {
    broker_messages: [{ id: 'existing', company_id: 'company', gmail_connection_id: 'connection',
      provider_message_id: '<message@example.test>', raw_storage_path: 'cloudinary:existing' }],
    broker_attachments: [{ id: 'attachment', message_id: 'existing', company_id: 'company',
      mime_type: 'application/pdf', checksum_sha256: checksum, storage_path: 'cloudinary:attachment' }],
    ai_extractions: [{ attachment_id: 'attachment', company_id: 'company', status: 'extracted' }],
  } });
  await h.run(); assert.equal(called(h, 'http').length, 0);
  assert.equal(h.rows.broker_messages.length, 1); assert.equal(h.rows.broker_attachments.length, 1);
});

test('unsupported attachments remain durable raw mail and review status without AI', async () => {
  const h = harness({ parsed: { attachments: [{ filename: 'terms.exe', contentType: 'application/octet-stream', content: source }] } });
  await h.run();
  assert.equal(h.rows.broker_messages[0].status, 'needs_review');
  assert.equal(h.rows.broker_messages[0].raw_storage_path, 'cloudinary:test');
  assert.equal(called(h, 'http', 'process-broker-attachment').length, 0);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker').length, 1);
});

test('checkpoint rejection surfaces failure and skips all maintenance', async () => {
  const h = harness({ checkpointStatus: 'lost' });
  await assert.rejects(h.run(), { code: 'GMAIL_CHECKPOINT_REJECTED' });
  assert.equal(called(h, 'http', 'process-broker-attachment').length, 0);
});

test('provider error text is never surfaced and failed message does not checkpoint', async () => {
  const h = harness({ fetch: () => { throw Error('sensitive provider content'); } });
  await assert.rejects(h.run(), error => error.code === 'GMAIL_SYNC_FAILED' && !error.message.includes('sensitive'));
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker').length, 0);
});

test('deadline closes IMAP and prevents late continuation from writing', async () => {
  const h = harness({ maxRunMs: 25, parse: () => new Promise(resolve => setTimeout(() => resolve({ attachments: [] }), 100)) });
  await assert.rejects(h.run(), { code: 'GMAIL_DEADLINE' });
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(called(h, 'close').length, 1); assert.equal(called(h, 'http').length, 0);
});

test('empty UID holes checkpoint only the bounded searched range', async () => {
  const h = harness({ uids: [], mailbox: { uidNext: 999999 } });
  await h.run();
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker')[0][2].p_last_uid, 510);
  assert.equal(called(h, 'fetch').length, 0);
});

test('warm invocations do not share mailbox or lease state', async () => {
  const first = harness({ credentials: { connection_id: 'wrong' } });
  await assert.rejects(first.run());
  const second = harness(); assert.equal((await second.run()).synced, 1);
});

test('fresh or legacy unverified baseline stops before credential lookup and IMAP', async () => {
  for (const cursor of ['0', '10']) {
    const h = harness({ connection: { provider_history_id: cursor, uid_validity: null } });
    await assert.rejects(h.run(), { code: 'GMAIL_UIDVALIDITY_UNVERIFIED' });
    assert.equal(called(h, 'rpc', 'get_gmail_worker_credentials').length, 0);
    assert.equal(called(h, 'client').length, 0);
  }
});

test('partial source cannot checkpoint a silently truncated email', async () => {
  const h = harness({ advertisedSize: source.byteLength + 1 });
  await assert.rejects(h.run(), { code: 'GMAIL_SOURCE_INCOMPLETE' });
  assert.equal(called(h, 'parse').length, 0);
  assert.equal(called(h, 'rpc', 'checkpoint_gmail_cloud_worker').length, 0);
});

test('valid PDF alongside unsupported attachment still processes while raw mail is retained', async () => {
  const h = harness({ parsed: { attachments: [
    { filename: 'rate.pdf', contentType: 'application/pdf', content: new TextEncoder().encode('%PDF-test') },
    { filename: 'notes.xls', contentType: 'application/octet-stream', content: source },
  ] } });
  const result = await h.run();
  assert.equal(result.processed, 1); assert.equal(result.skipped, 1);
  assert.notEqual(h.rows.broker_messages[0].status, 'needs_review');
  assert.equal(h.rows.broker_messages[0].raw_storage_path, 'cloudinary:test');
});

test('one label is scoped, recovered first, and completed with unique run owner', async () => {
  const h = harness({ uids: [], rows: {
    jobs: [{ id: 'labeljob', type: 'gmail_create_driver_label', payload: { driver_id: 'driver', label: 'Driver A' } }],
    driver_profiles: [{ company_id: 'company', user_id: 'driver', gmail_label: 'Driver A' }],
  } });
  const result = await h.run();
  assert.equal(result.labeled, 1);
  assert.equal(called(h, 'label')[0][1], 'Driver A');
  assert.equal(called(h, 'rpc', 'claim_company_gmail_label_jobs')[0][2].batch_size, 1);
  assert.equal(called(h, 'rpc', 'complete_job')[0][2].worker_id, 'gmail-cloud:owner');
  assert.equal(called(h, 'rpc', 'recover_gmail_cloud_label_jobs')[0][2].p_limit, 1);
});

test('foreign-company label job cannot mutate Gmail label', async () => {
  const h = harness({ uids: [], rows: {
    jobs: [{ id: 'labeljob', type: 'gmail_create_driver_label', payload: { driver_id: 'driver', label: 'Driver A' } }],
    driver_profiles: [{ company_id: 'other', user_id: 'driver', gmail_label: 'Driver A' }],
  } });
  const result = await h.run(); assert.equal(result.skipped, 1); assert.equal(called(h, 'label').length, 0);
});

test('Cloudinary authenticated raw download API is allowed for one body backfill', async () => {
  const h = harness({ uids: [], rows: { broker_messages: [
    { id: 'old', company_id: 'company', gmail_connection_id: 'connection', body_text: null, raw_storage_path: 'cloudinary:raw' },
  ] }, fetch: ({ url, init }) => {
    if (url.endsWith('/cloudinary-media')) {
      assert.equal(JSON.parse(init.body).action, 'signedUrl');
      return new Response('{"url":"https://api.cloudinary.com/v1_1/test_cloud/raw/download?signature=test"}');
    }
    assert.equal(init.redirect, 'error');
    return new Response(source);
  } });
  assert.equal((await h.run()).backfilled, 1);
  assert.equal(h.rows.broker_messages[0].body_text, 'hello');
});

test('signed media URL cannot redirect backfill to arbitrary host or API route', async () => {
  for (const url of ['https://evil.example/file', 'https://api.cloudinary.com/v1_1/cloud/raw/destroy']) {
    const h = harness({ uids: [], rows: { broker_messages: [
      { id: 'old', company_id: 'company', gmail_connection_id: 'connection', raw_storage_path: 'cloudinary:raw' },
    ] }, fetch: () => new Response(JSON.stringify({ url })) });
    const result = await h.run(); assert.equal(result.backfilled, 0); assert.equal(result.failed, 1);
    assert.equal(called(h, 'http').length, 1);
  }
});

test('hanging logout cannot hold a completed runtime past its deadline', async () => {
  const h = harness({ uids: [], maxRunMs: 35, hangingLogout: true });
  const started = Date.now(); await h.run();
  assert.ok(Date.now() - started < 500); assert.equal(called(h, 'close').length, 1);
});

test('AI selection remains bounded and uses the database filtered selector', async () => {
  const h = harness(); await h.run();
  assert.equal(called(h, 'rpc', 'select_gmail_cloud_pending_attachments')[0][2].p_limit, 1);
  assert.equal(called(h, 'http', 'process-broker-attachment').length, 1);
});

test('HTML-only mail uses a bounded plain-text conversion without reparsing attachments', async () => {
  const h = harness({ parsed: { text: '', html: '<p>Pickup tomorrow</p>', attachments: [] },
    parse: ({ parsed, parseOptions, bytes }) => {
      if (parseOptions.skipHtmlToText) return parsed;
      assert.ok(bytes.length < 65_000); assert.equal(parseOptions.maxHtmlLengthToParse, 64_000);
      return { text: 'Pickup tomorrow' };
    } });
  await h.run(); assert.equal(h.rows.broker_messages[0].body_text, 'Pickup tomorrow');
  assert.equal(h.rows.broker_messages[0].body_truncated, false);
});

test('large HTML preserves the original and marks bounded body conversion truncated', async () => {
  const h = harness({ parsed: { text: '', html: '<p>hello</p>'.repeat(10_000), attachments: [] },
    parse: ({ parsed, parseOptions, bytes }) => {
      if (parseOptions.skipHtmlToText) return parsed;
      assert.ok(bytes.length < 65_000); return { text: 'hello' };
    } });
  await h.run(); assert.equal(h.rows.broker_messages[0].body_truncated, true);
  assert.equal(h.rows.broker_messages[0].raw_storage_path, 'cloudinary:test');
});

test('cutover retry reuses legacy no-Message-ID identity and repairs absent raw reference', async () => {
  const h = harness({ parsed: { messageId: null, attachments: [] }, rows: { broker_messages: [
    { id: 'legacy', company_id: 'company', gmail_connection_id: 'connection',
      provider_message_id: 'imap:mailbox@example.test:11', raw_storage_path: null },
  ] } });
  await h.run(); assert.equal(h.rows.broker_messages.length, 1);
  assert.equal(h.rows.broker_messages[0].raw_storage_path, 'cloudinary:test');
  assert.equal(called(h, 'rpc', 'ingest_broker_message_guarded')[0][2].provider_message_id, 'imap:mailbox@example.test:11');
});
