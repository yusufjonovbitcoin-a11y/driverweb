import { simpleParser } from 'mailparser';

export function validGmailLabel(value) {
  const label = String(value || '').trim();
  return label.length > 0 && label.length <= 100
    && !/[\u0000-\u001f\u007f]/.test(label)
    && !/^(inbox|\[gmail\]|\[googlemail\])(\/|$)/i.test(label);
}

export async function findExactGmailMessage(client, { messageId, fromEmail }) {
  if (!messageId || messageId.startsWith('imap:')) return null;
  const mailboxes = await client.list();
  const allMail = mailboxes.find((mailbox) => mailbox.specialUse === '\\All')?.path;
  for (const path of [...new Set(['INBOX', allMail].filter(Boolean))]) {
    const lock = await client.getMailboxLock(path);
    try {
      const uids = await client.search({ header: { 'Message-ID': messageId } }, { uid: true });
      if (!Array.isArray(uids) || uids.length !== 1) continue;
      const message = await client.fetchOne(uids[0], {
        headers: ['message-id'], envelope: true,
      }, { uid: true });
      if (!message?.headers) continue;
      const parsed = await simpleParser(message.headers);
      const actualFrom = message.envelope?.from?.[0]?.address?.toLowerCase();
      if (parsed.messageId !== messageId || actualFrom !== fromEmail?.toLowerCase()) continue;
      return { path, uid: uids[0] };
    } finally {
      lock.release();
    }
  }
  return null;
}

async function one(client, table, fields, column, value, companyId) {
  const { data, error } = await client.from(table).select(fields)
    .eq(column, value).eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function processGmailLabelJob({ admin, client, job, companyId, connectionId }) {
  if (job.type === 'gmail_create_driver_label') {
    const driver = await one(admin, 'driver_profiles', 'user_id,gmail_label',
      'user_id', job.payload?.driver_id, companyId);
    const label = job.payload?.label;
    if (!driver || driver.gmail_label !== label) return 'skipped';
    if (!validGmailLabel(label)) throw new Error('Invalid driver Gmail label');
    await client.mailboxCreate(label);
    return 'created';
  }
  if (job.type !== 'gmail_label_assignment') throw new Error('Unknown Gmail label job');
  const assignment = await one(admin, 'assignments',
    'id,load_id,driver_id,status', 'id', job.payload?.assignment_id, companyId);
  if (!assignment || assignment.status !== 'active') return 'skipped';
  const load = await one(admin, 'loads',
    'id,broker_message_id,current_assignment_id', 'id', assignment.load_id, companyId);
  if (!load?.broker_message_id || load.current_assignment_id !== assignment.id) return 'skipped';
  const driver = await one(admin, 'driver_profiles', 'user_id,gmail_label',
    'user_id', assignment.driver_id, companyId);
  if (!driver?.gmail_label || !validGmailLabel(driver.gmail_label)) return 'skipped';
  const brokerMessage = await one(admin, 'broker_messages',
    'id,gmail_connection_id,provider_message_id,from_email',
    'id', load.broker_message_id, companyId);
  if (!brokerMessage || brokerMessage.gmail_connection_id !== connectionId) return 'skipped';
  const { data: pdf, error: pdfError } = await admin.from('broker_attachments')
    .select('id').eq('company_id', companyId).eq('message_id', brokerMessage.id)
    .eq('mime_type', 'application/pdf').limit(1).maybeSingle();
  if (pdfError) throw pdfError;
  if (!pdf) return 'skipped';
  const target = await findExactGmailMessage(client, {
    messageId: brokerMessage.provider_message_id,
    fromEmail: brokerMessage.from_email,
  });
  if (!target) throw new Error('Exact Gmail source message was not found');
  await client.mailboxCreate(driver.gmail_label);
  const lock = await client.getMailboxLock(target.path);
  try {
    const added = await client.messageFlagsAdd(target.uid,
      [driver.gmail_label], { uid: true, useLabels: true });
    if (!added) throw new Error('Gmail did not confirm label update');
  } finally {
    lock.release();
  }
  return 'labeled';
}

export async function drainGmailLabelJobs({ admin, client, companyId, connectionId }) {
  const workerId = `gmail-label:${companyId}:${process.pid}`;
  const { data: jobs, error } = await admin.rpc('claim_company_gmail_label_jobs', {
    target_company_id: companyId, worker_id: workerId, batch_size: 10,
  });
  if (error) throw error;
  const counts = { created: 0, labeled: 0, skipped: 0, failed: 0 };
  for (const job of jobs || []) {
    try {
      const result = await processGmailLabelJob({ admin, client, job, companyId, connectionId });
      counts[result] += 1;
      const { error: completeError } = await admin.rpc('complete_job', {
        job_id: job.id, worker_id: workerId,
      });
      if (completeError) throw completeError;
    } catch (jobError) {
      counts.failed += 1;
      const { error: failError } = await admin.rpc('fail_job', {
        job_id: job.id, worker_id: workerId,
        error_message: String(jobError?.message || jobError).slice(0, 4000),
        retry_after: '5 minutes',
      });
      if (failError) throw failError;
    }
  }
  return counts;
}
