// No imports, environment reads or provider calls at module initialization.
// The HTTP adapter owns claim/release; this module owns one bounded IMAP session.
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_RUN_MS = 90_000;
const MIME_EXTENSIONS = new Map([['.pdf', 'application/pdf'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif']]);
const SUPPORTED = new Set(MIME_EXTENSIONS.values());
const PARSE_OPTIONS = Object.freeze({ skipHtmlToText: true, skipTextToHtml: true,
  skipImageLinks: true, maxHtmlLengthToParse: 100_000 });

export class GmailRuntimeError extends Error {
  constructor(code) { super(code); this.name = 'GmailRuntimeError'; this.code = code; }
}
const fail = code => { throw new GmailRuntimeError(code); };
const safeName = name => String(name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160);
const mimeType = attachment => SUPPORTED.has(attachment.contentType) ? attachment.contentType
  : [...MIME_EXTENSIONS].find(([extension]) => String(attachment.filename || '').toLowerCase().endsWith(extension))?.[1];
const bodyFields = parsed => {
  const text = String(parsed?.text || '').replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  return { body_text: text.slice(0, 300_000), body_truncated: text.length > 300_000 || parsed?._bodyTruncated === true };
};
const validLabel = label => typeof label === 'string' && label.trim().length > 0 && label.length <= 100
  && !/[\u0000-\u001f\u007f]/.test(label) && !/^(inbox|\[gmail\]|\[googlemail\])(\/|$)/i.test(label);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');

export async function runGmailSync(config, deps) {
  const { admin, companyId, leaseOwner, connection, workerToken, supabaseUrl, serviceRoleKey } = config;
  const now = deps.now || Date.now;
  const fetcher = deps.fetch || globalThis.fetch;
  const maxRunMs = Math.min(MAX_RUN_MS, Math.max(1, Number(config.maxRunMs) || MAX_RUN_MS));
  const deadline = now() + maxRunMs;
  const controller = new AbortController();
  let client;
  let mailboxLock;
  let uidValidity = null;
  let mailboxEmail = '';
  let closed = false;
  const counters = { status: 'completed', synced: 0, documents: 0, processed: 0,
    backfilled: 0, labeled: 0, skipped: 0, failed: 0 };
  const snapshot = { p_company_id: companyId, p_owner: leaseOwner,
    p_connection_id: connection?.connection_id || connection?.id,
    p_configuration_version: connection?.configuration_version };
  const close = () => { if (!closed) { closed = true; try { client?.close(); } catch { /* bounded cleanup */ } } };
  const timer = setTimeout(() => { controller.abort(); close(); }, maxRunMs);
  const remaining = () => deadline - now();

  // Every awaited operation is bounded. Abort-aware HTTP/DB clients also cancel
  // their underlying request; timeout closes the IMAP socket, not just the race.
  async function bounded(operation, limit = 15_000) {
    if (controller.signal.aborted || remaining() <= 0) fail('GMAIL_DEADLINE');
    let timeout;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(); close(); reject(new GmailRuntimeError('GMAIL_DEADLINE'));
        }, Math.max(1, Math.min(limit, remaining())));
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function db(query) {
    const result = await bounded(() => query.abortSignal ? query.abortSignal(controller.signal) : query);
    if (result?.error) fail('GMAIL_DATABASE_ERROR');
    return result?.data;
  }
  async function rpc(name, args) { return await db(admin.rpc(name, args)); }
  async function guard() {
    const result = await rpc('assert_gmail_cloud_worker', { ...snapshot, p_uid_validity: uidValidity });
    if (result?.status !== 'valid') fail(result?.status === 'uid_validity_unverified'
      ? 'GMAIL_UIDVALIDITY_UNVERIFIED' : result?.status === 'uid_validity_mismatch'
        ? 'GMAIL_UIDVALIDITY_CHANGED' : 'GMAIL_LEASE_LOST');
  }
  async function effect(operation, limit) { await guard(); return await bounded(operation, limit); }
  async function write(queryFactory) { await guard(); return await db(queryFactory()); }
  async function one(table, fields, column, value) {
    return await db(admin.from(table).select(fields).eq(column, value).eq('company_id', companyId).maybeSingle());
  }
  async function readResponse(response, maxBytes = 256 * 1024) {
    if (!response.ok) fail('GMAIL_PROVIDER_ERROR');
    const advertised = Number(response.headers.get('content-length'));
    if (advertised > maxBytes) { await response.body?.cancel(); fail('GMAIL_RESPONSE_TOO_LARGE'); }
    if (!response.body) fail('GMAIL_PROVIDER_ERROR');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await bounded(() => reader.read());
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) fail('GMAIL_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async function edge(name, body, { timeout = 20_000, form = false } = {}) {
    return await effect(async () => {
      const response = await fetcher(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey,
          'X-Worker-Token': workerToken, ...(form ? {} : { 'Content-Type': 'application/json' }) },
        body: form ? body : JSON.stringify(body),
      });
      return JSON.parse(new TextDecoder().decode(await readResponse(response)));
    }, timeout);
  }
  async function upload(content, fileName, mime, scope, contextId) {
    const form = new FormData();
    form.set('companyId', companyId); form.set('scope', scope); form.set('contextId', contextId);
    form.set('file', new Blob([content], { type: mime }), fileName);
    const result = await edge('cloudinary-media', form, { form: true });
    // Preserve existing Cloudinary storage policy; do not silently switch backend.
    if (typeof result?.reference !== 'string' || !result.reference.startsWith('cloudinary:')) fail('GMAIL_UPLOAD_FAILED');
    return result.reference;
  }
  async function parse(source) {
    if (!(source instanceof Uint8Array) || source.byteLength < 1 || source.byteLength > MAX_SOURCE_BYTES)
      fail('GMAIL_SOURCE_TOO_LARGE');
    const parsed = await bounded(() => deps.parseMail(source, PARSE_OPTIONS), 10_000);
    if (!parsed || (parsed.attachments?.length || 0) > 20) fail('GMAIL_MESSAGE_TOO_COMPLEX');
    if (!String(parsed.text || '').trim() && typeof parsed.html === 'string' && parsed.html.length) {
      // Convert only a small decoded HTML part, not the full MIME/attachments a
      // second time. Mailparser's bounded converter yields plain text; raw HTML
      // is never stored as body_text. The complete original remains retained.
      const limit = 64_000;
      const html = parsed.html.slice(0, limit);
      parsed._bodyTruncated = parsed.html.length > limit;
      const htmlPart = new TextEncoder().encode(`Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}`);
      try {
        const converted = await bounded(() => deps.parseMail(htmlPart, { ...PARSE_OPTIONS,
          skipHtmlToText: false, maxHtmlLengthToParse: limit }), 5_000);
        parsed.text = String(converted?.text || '');
      } catch (error) {
        if (error?.code === 'GMAIL_DEADLINE') throw error;
        parsed.text = ''; parsed._bodyTruncated = true;
      }
    }
    return parsed;
  }
  async function checkpoint(uid) {
    await guard();
    const result = await rpc('checkpoint_gmail_cloud_worker', { ...snapshot,
      p_uid_validity: uidValidity, p_last_uid: uid });
    if (result?.status !== 'checkpointed') fail('GMAIL_CHECKPOINT_REJECTED');
  }
  async function ingest(message) {
    const parsed = await parse(message.source);
    await guard();
    let providerId = parsed.messageId || `imap:${snapshot.p_connection_id}:${uidValidity}:${message.uid}`;
    let saved = await one('broker_messages', 'id,gmail_connection_id,raw_storage_path', 'provider_message_id', providerId);
    if (!saved && !parsed.messageId) {
      // A Mac worker may already have persisted this mail before its checkpoint.
      // Reuse its legacy fallback ID during cutover instead of creating a twin.
      const legacyId = `imap:${mailboxEmail}:${message.uid}`;
      saved = await one('broker_messages', 'id,gmail_connection_id,raw_storage_path', 'provider_message_id', legacyId);
      if (saved) providerId = legacyId;
    }
    if (saved && saved.gmail_connection_id !== snapshot.p_connection_id) fail('GMAIL_MESSAGE_SCOPE_MISMATCH');
    const rawPath = saved?.raw_storage_path || await upload(message.source, `${message.uid}.eml`,
      'message/rfc822', 'gmail_raw', snapshot.p_connection_id);
    const date = new Date(parsed.date || message.envelope?.date || now());
    if (!Number.isFinite(date.getTime())) fail('GMAIL_MESSAGE_INVALID');
    await guard();
    const messageId = await rpc('ingest_broker_message_guarded', {
      gmail_connection_id: snapshot.p_connection_id, expected_configuration_version: snapshot.p_configuration_version,
      provider_message_id: providerId, provider_thread_id: parsed.inReplyTo || null,
      from_email: parsed.from?.value?.[0]?.address || message.envelope?.from?.[0]?.address || mailboxEmail,
      subject: parsed.subject || null, received_at: date.toISOString(), raw_storage_path: rawPath,
    });
    if (!messageId) fail('GMAIL_INGEST_FAILED');
    const updated = await write(() => admin.from('broker_messages').update({ ...bodyFields(parsed), raw_storage_path: rawPath })
      .eq('id', messageId).eq('company_id', companyId).select('id').maybeSingle());
    if (!updated) fail('GMAIL_INGEST_FAILED');
    let unsupported = false;
    let supportedCount = 0;
    for (const attachment of parsed.attachments || []) {
      const mime = mimeType(attachment);
      if (!mime || !attachment.content?.byteLength) { unsupported = true; continue; }
      supportedCount++;
      if (attachment.content.byteLength > MAX_SOURCE_BYTES) fail('GMAIL_SOURCE_TOO_LARGE');
      const checksum = await bounded(() => digest(attachment.content));
      const existing = await db(admin.from('broker_attachments').select('id,storage_path')
        .eq('company_id', companyId).eq('message_id', messageId).eq('checksum_sha256', checksum).maybeSingle());
      if (existing) { counters.documents++; continue; }
      const fileName = safeName(attachment.filename || `attachment${[...MIME_EXTENSIONS].find(([, type]) => type === mime)?.[0] || ''}`);
      const reference = await upload(attachment.content, fileName, mime, 'broker_original', messageId);
      await write(() => admin.from('broker_attachments').upsert({ company_id: companyId, message_id: messageId,
        file_name: fileName, mime_type: mime, storage_path: reference, checksum_sha256: checksum,
        size_bytes: attachment.content.byteLength }, { onConflict: 'message_id,checksum_sha256', ignoreDuplicates: true }));
      counters.documents++;
    }
    if (unsupported) counters.skipped++;
    if (unsupported && supportedCount === 0) await write(() => admin.from('broker_messages').update({ status: 'needs_review',
      error_message: 'GMAIL_UNSUPPORTED_ATTACHMENT: original email retained for review' })
      .eq('id', messageId).eq('company_id', companyId));
    await checkpoint(Number(message.uid));
    counters.synced++;
  }

  async function maintenanceAi() {
    // SQL filters terminal/cooldown work before LIMIT, avoiding both starvation
    // behind old completed rows and whole-company materialization in Edge memory.
    await guard();
    const selected = await rpc('select_gmail_cloud_pending_attachments', { ...snapshot, p_limit: 1 });
    if (selected?.status !== 'selected') fail('GMAIL_LEASE_LOST');
    const row = selected.attachments?.[0];
    if (!row || remaining() <= 35_000) return;
    await write(() => admin.from('broker_attachments').update({ ai_last_attempt_at: new Date(now()).toISOString() })
      .eq('id', row.id).eq('company_id', companyId));
    await edge('process-broker-attachment', { attachmentId: row.id }, { timeout: Math.min(30_000, remaining() - 3_000) });
    counters.processed++;
  }
  async function maintenanceBody() {
    const rows = await db(admin.from('broker_messages').select('id,raw_storage_path')
      .eq('company_id', companyId).eq('gmail_connection_id', snapshot.p_connection_id)
      .is('body_text', null).not('raw_storage_path', 'is', null).order('received_at', { ascending: false }).limit(1));
    if (!rows?.length) return;
    const row = rows[0]; let source;
    if (row.raw_storage_path.startsWith('cloudinary:')) {
      const signed = await edge('cloudinary-media', { action: 'signedUrl', reference: row.raw_storage_path });
      const url = new URL(signed.url);
      const allowedCloudinary = url.hostname === 'res.cloudinary.com'
        || (url.hostname === 'api.cloudinary.com' && /^\/v1_1\/[a-zA-Z0-9_-]+\/(raw|image|video)\/download$/.test(url.pathname));
      if (url.protocol !== 'https:' || !allowedCloudinary || url.username || url.password || url.port) fail('GMAIL_MEDIA_URL_INVALID');
      source = await bounded(async () => readResponse(await fetcher(url.href,
        { redirect: 'error', signal: controller.signal }), MAX_SOURCE_BYTES));
    } else {
      // Existing Supabase-storage originals remain readable; stream through its
      // signed URL to enforce the limit before buffering the object.
      await guard();
      const signed = await bounded(() => admin.storage.from('broker-originals').createSignedUrl(row.raw_storage_path, 60));
      if (signed.error || !signed.data?.signedUrl) fail('GMAIL_MEDIA_URL_INVALID');
      const url = new URL(signed.data.signedUrl);
      if (url.origin !== new URL(supabaseUrl).origin || url.protocol !== 'https:') fail('GMAIL_MEDIA_URL_INVALID');
      source = await bounded(async () => readResponse(await fetcher(url.href,
        { redirect: 'error', signal: controller.signal }), MAX_SOURCE_BYTES));
    }
    const parsed = await parse(source);
    await write(() => admin.from('broker_messages').update(bodyFields(parsed)).eq('id', row.id).eq('company_id', companyId));
    counters.backfilled++;
  }
  async function maintenanceLabel() {
    await guard();
    const recovered = await rpc('recover_gmail_cloud_label_jobs', { ...snapshot, p_limit: 1 });
    if (recovered?.status !== 'recovered') fail('GMAIL_LEASE_LOST');
    await guard();
    const workerId = `gmail-cloud:${leaseOwner}`;
    const jobs = await rpc('claim_company_gmail_label_jobs', { target_company_id: companyId,
      worker_id: workerId, batch_size: 1 });
    if (!jobs?.length) return;
    const job = jobs[0];
    try {
      let label; let message;
      if (job.type === 'gmail_create_driver_label') {
        const driver = await one('driver_profiles', 'gmail_label', 'user_id', job.payload?.driver_id);
        if (driver?.gmail_label === job.payload?.label) label = driver.gmail_label;
      } else if (job.type === 'gmail_label_assignment') {
        const assignment = await one('assignments', 'id,load_id,driver_id,status', 'id', job.payload?.assignment_id);
        if (assignment?.status === 'active') {
          const load = await one('loads', 'broker_message_id,current_assignment_id', 'id', assignment.load_id);
          if (load?.current_assignment_id === assignment.id && load.broker_message_id) {
            const driver = await one('driver_profiles', 'gmail_label', 'user_id', assignment.driver_id);
            message = await one('broker_messages', 'id,gmail_connection_id,provider_message_id,from_email', 'id', load.broker_message_id);
            const pdf = await db(admin.from('broker_attachments').select('id').eq('company_id', companyId)
              .eq('message_id', load.broker_message_id).eq('mime_type', 'application/pdf').limit(1).maybeSingle());
            if (message?.gmail_connection_id === snapshot.p_connection_id && pdf) label = driver?.gmail_label;
          }
        }
      } else fail('GMAIL_LABEL_INVALID');
      if (label) {
        if (!validLabel(label)) fail('GMAIL_LABEL_INVALID');
        if (job.type === 'gmail_create_driver_label') await effect(() => client.mailboxCreate(label));
        else {
          if (!message.provider_message_id || message.provider_message_id.startsWith('imap:')) fail('GMAIL_LABEL_MESSAGE_MISSING');
          const mailboxes = await bounded(() => client.list());
          const paths = [...new Set(['INBOX', mailboxes.find(box => box.specialUse === '\\All')?.path].filter(Boolean))];
          let found = false;
          for (const path of paths) {
            const lock = await bounded(() => client.getMailboxLock(path));
            try {
              const ids = await bounded(() => client.search({ header: { 'Message-ID': message.provider_message_id } }, { uid: true }));
              if (!Array.isArray(ids) || ids.length !== 1) continue;
              const mail = await bounded(() => client.fetchOne(ids[0], { headers: ['message-id'], envelope: true }, { uid: true }));
              if (!mail?.headers || mail.headers.byteLength > 64 * 1024) continue;
              const parsed = await bounded(() => deps.parseMail(mail.headers, PARSE_OPTIONS));
              if (parsed.messageId !== message.provider_message_id
                || mail.envelope?.from?.[0]?.address?.toLowerCase() !== message.from_email?.toLowerCase()) continue;
              await effect(() => client.mailboxCreate(label));
              if (!await effect(() => client.messageFlagsAdd(ids[0], [label], { uid: true, useLabels: true }))) fail('GMAIL_LABEL_FAILED');
              found = true; break;
            } finally { lock.release(); }
          }
          if (!found) fail('GMAIL_LABEL_MESSAGE_MISSING');
        }
        counters.labeled++;
      } else counters.skipped++;
      await guard(); await rpc('complete_job', { job_id: job.id, worker_id: workerId });
    } catch (error) {
      // If the lease is lost, leave the job to scoped stale-lease recovery rather
      // than allowing the previous owner to mutate it.
      await guard();
      await rpc('fail_job', { job_id: job.id, worker_id: workerId,
        error_message: 'GMAIL_LABEL_FAILED', retry_after: '5 minutes' });
      throw error;
    }
  }

  try {
    if (!snapshot.p_connection_id || !companyId || !leaseOwner || !workerToken || !serviceRoleKey
      || new URL(supabaseUrl).protocol !== 'https:') fail('GMAIL_CONFIGURATION_INVALID');
    await guard();
    // Even a fresh cursor requires an explicitly verified operator baseline.
    // Deployment must never silently start importing historical mail.
    if (!/^[1-9]\d*$/.test(String(connection.uid_validity || ''))) fail('GMAIL_UIDVALIDITY_UNVERIFIED');
    const rows = await rpc('get_gmail_worker_credentials', { target_company_id: companyId });
    const credentials = Array.isArray(rows) ? rows[0] : rows;
    if (!credentials?.mailbox_email || !credentials.app_password
      || credentials.connection_id !== snapshot.p_connection_id
      || String(credentials.configuration_version) !== String(snapshot.p_configuration_version)
      || (credentials.company_id && credentials.company_id !== companyId)) fail('GMAIL_CREDENTIAL_SCOPE_MISMATCH');
    await guard();
    mailboxEmail = credentials.mailbox_email;
    client = deps.createImapClient({ host: 'imap.gmail.com', port: 993, secure: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: { user: credentials.mailbox_email, pass: credentials.app_password },
      logger: false, disableAutoIdle: true, disableCompression: true,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    // Never let EventEmitter errors escape into a process-level crash/log dump.
    client.on?.('error', () => { controller.abort(); close(); });
    await effect(() => client.connect());
    mailboxLock = await bounded(() => client.getMailboxLock('INBOX'));
    uidValidity = String(client.mailbox?.uidValidity || '');
    const nextUid = Number(client.mailbox?.uidNext);
    const lastUid = Number(connection.provider_history_id || 0);
    if (!/^[1-9]\d*$/.test(uidValidity) || !Number.isSafeInteger(nextUid) || nextUid < 1
      || !Number.isSafeInteger(lastUid) || lastUid < 0) fail('GMAIL_UID_INVALID');
    await guard();
    // Bound the IMAP SEARCH response as well as message bodies. Empty UID holes
    // may be checkpointed only after the server confirms no messages in range.
    const through = Math.min(nextUid - 1, lastUid + 500);
    if (through > lastUid) {
      const ids = await bounded(() => client.search({ uid: `${lastUid + 1}:${through}` }, { uid: true }));
      if (!Array.isArray(ids) || ids.length > 500) fail('GMAIL_UID_INVALID');
      const sorted = [...new Set(ids.map(Number))].sort((a, b) => a - b);
      if (sorted.some(uid => !Number.isSafeInteger(uid) || uid <= lastUid || uid > through)) fail('GMAIL_UID_INVALID');
      if (sorted.length) {
        const uid = sorted[0];
        await guard();
        const metadata = await bounded(() => client.fetchOne(uid, { size: true }, { uid: true }));
        if (!Number.isSafeInteger(metadata?.size) || metadata.size < 1 || metadata.size > MAX_SOURCE_BYTES) fail('GMAIL_SOURCE_TOO_LARGE');
        await guard();
        const message = await bounded(() => client.fetchOne(uid,
          { source: { start: 0, maxLength: MAX_SOURCE_BYTES + 1 }, envelope: true }, { uid: true }));
        if (!message || Number(message.uid) !== uid) fail('GMAIL_MESSAGE_INVALID');
        if (message.source?.byteLength > MAX_SOURCE_BYTES) fail('GMAIL_SOURCE_TOO_LARGE');
        if (message.source?.byteLength !== metadata.size) fail('GMAIL_SOURCE_INCOMPLETE');
        await ingest(message);
      } else await checkpoint(through);
    }
    mailboxLock.release(); mailboxLock = null;
    // At most one item of each maintenance kind. AI is last so a slow provider
    // cannot prevent label/body work indefinitely. All failures are sanitized.
    for (const [minimum, task] of [[15_000, maintenanceLabel], [15_000, maintenanceBody], [35_000, maintenanceAi]]) {
      if (remaining() <= minimum) break;
      try { await task(); } catch (error) {
        if (['GMAIL_LEASE_LOST', 'GMAIL_UIDVALIDITY_CHANGED', 'GMAIL_UIDVALIDITY_UNVERIFIED', 'GMAIL_DEADLINE'].includes(error?.code)) throw error;
        counters.failed++;
      }
    }
    await guard();
    return counters;
  } catch (error) {
    if (error instanceof GmailRuntimeError) throw error;
    throw new GmailRuntimeError(controller.signal.aborted ? 'GMAIL_DEADLINE' : 'GMAIL_SYNC_FAILED');
  } finally {
    clearTimeout(timer);
    try { mailboxLock?.release(); } catch { /* bounded cleanup */ }
    // LOGOUT is optional protocol courtesy, never an unbounded shutdown wait.
    if (!closed && remaining() > 0) {
      let cleanup;
      try { await Promise.race([Promise.resolve().then(() => client?.logout()).catch(() => {}),
        new Promise(resolve => { cleanup = setTimeout(resolve, Math.min(1_000, Math.max(1, remaining()))); })]);
      } finally { clearTimeout(cleanup); }
    }
    controller.abort(); close();
  }
}
