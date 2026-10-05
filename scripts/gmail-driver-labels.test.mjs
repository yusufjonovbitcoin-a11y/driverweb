import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExactGmailMessage, processGmailLabelJob, validGmailLabel } from './gmail-driver-labels.mjs';

const makeMail = (searchResults, actualId = '<pdf@example.com>', actualFrom = 'broker@example.com') => {
  const opened = [];
  return {
    opened,
    async list() { return [{ path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' }]; },
    async getMailboxLock(path) {
      opened.push(path);
      return { release() {} };
    },
    async search() { return searchResults[opened.at(-1)] || []; },
    async fetchOne(uid) {
      assert.equal(uid, 42);
      return {
        headers: Buffer.from(`Message-ID: ${actualId}\r\nFrom: ${actualFrom}\r\n\r\n`),
        envelope: { from: [{ address: actualFrom }] },
      };
    },
  };
};

test('driver label names reject Gmail system labels and control characters', () => {
  assert.equal(validGmailLabel('Ali Driver'), true);
  assert.equal(validGmailLabel('  '), false);
  assert.equal(validGmailLabel('[Gmail]/All Mail'), false);
  assert.equal(validGmailLabel('INBOX'), false);
  assert.equal(validGmailLabel('Ali\nDriver'), false);
});

test('exact PDF source email can be found in All Mail after leaving Inbox', async () => {
  const mail = makeMail({ INBOX: [], '[Gmail]/All Mail': [42] });
  const result = await findExactGmailMessage(mail, {
    messageId: '<pdf@example.com>', fromEmail: 'broker@example.com',
  });
  assert.deepEqual(result, { path: '[Gmail]/All Mail', uid: 42 });
});

test('ambiguous or mismatched email is never labeled', async () => {
  const ambiguous = makeMail({ INBOX: [42, 43], '[Gmail]/All Mail': [42, 43] });
  assert.equal(await findExactGmailMessage(ambiguous, {
    messageId: '<pdf@example.com>', fromEmail: 'broker@example.com',
  }), null);
  const wrongSender = makeMail({ INBOX: [42], '[Gmail]/All Mail': [] },
    '<pdf@example.com>', 'different@example.com');
  assert.equal(await findExactGmailMessage(wrongSender, {
    messageId: '<pdf@example.com>', fromEmail: 'broker@example.com',
  }), null);
  assert.equal(await findExactGmailMessage(wrongSender, {
    messageId: 'imap:mailbox:42', fromEmail: 'broker@example.com',
  }), null);
});

function fakeAdmin(rows) {
  return {
    from(table) {
      const state = { table, filters: {} };
      const builder = {
        select() { return builder; },
        eq(field, value) { state.filters[field] = value; return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const data = (rows[state.table] || []).find((row) =>
            Object.entries(state.filters).every(([field, value]) => row[field] === value)) || null;
          return { data, error: null };
        },
      };
      return builder;
    },
  };
}

test('assignment labels only its specific Gmail PDF email', async () => {
  const rows = {
    assignments: [{ id: 'assignment', company_id: 'company', load_id: 'load', driver_id: 'driver', status: 'active' }],
    loads: [{ id: 'load', company_id: 'company', broker_message_id: 'message', current_assignment_id: 'assignment' }],
    driver_profiles: [{ user_id: 'driver', company_id: 'company', gmail_label: 'Ali Driver' }],
    broker_messages: [{ id: 'message', company_id: 'company', gmail_connection_id: 'connection', provider_message_id: '<pdf@example.com>', from_email: 'broker@example.com' }],
    broker_attachments: [{ id: 'pdf', company_id: 'company', message_id: 'message', mime_type: 'application/pdf' }],
  };
  const mail = makeMail({ INBOX: [42] });
  const changes = [];
  mail.mailboxCreate = async (label) => changes.push(['create', label]);
  mail.messageFlagsAdd = async (...args) => { changes.push(['label', ...args]); return true; };
  const result = await processGmailLabelJob({
    admin: fakeAdmin(rows), client: mail,
    job: { type: 'gmail_label_assignment', payload: { assignment_id: 'assignment' } },
    companyId: 'company', connectionId: 'connection',
  });
  assert.equal(result, 'labeled');
  assert.deepEqual(changes, [
    ['create', 'Ali Driver'],
    ['label', 42, ['Ali Driver'], { uid: true, useLabels: true }],
  ]);

  changes.length = 0;
  rows.broker_attachments.length = 0;
  assert.equal(await processGmailLabelJob({
    admin: fakeAdmin(rows), client: mail,
    job: { type: 'gmail_label_assignment', payload: { assignment_id: 'assignment' } },
    companyId: 'company', connectionId: 'connection',
  }), 'skipped');
  assert.deepEqual(changes, []);

  rows.broker_attachments.push({ id: 'pdf', company_id: 'company', message_id: 'message', mime_type: 'application/pdf' });
  rows.assignments[0].status = 'reassigned';
  assert.equal(await processGmailLabelJob({
    admin: fakeAdmin(rows), client: mail,
    job: { type: 'gmail_label_assignment', payload: { assignment_id: 'assignment' } },
    companyId: 'company', connectionId: 'connection',
  }), 'skipped');
  assert.deepEqual(changes, []);
});

test('creation job creates only the driver current label', async () => {
  const rows = { driver_profiles: [{ user_id: 'driver', company_id: 'company', gmail_label: 'Ali Driver' }] };
  const created = [];
  const client = { async mailboxCreate(label) { created.push(label); } };
  const base = { admin: fakeAdmin(rows), client, companyId: 'company', connectionId: 'connection' };
  assert.equal(await processGmailLabelJob({ ...base,
    job: { type: 'gmail_create_driver_label', payload: { driver_id: 'driver', label: 'Old name' } },
  }), 'skipped');
  assert.equal(await processGmailLabelJob({ ...base,
    job: { type: 'gmail_create_driver_label', payload: { driver_id: 'driver', label: 'Ali Driver' } },
  }), 'created');
  assert.deepEqual(created, ['Ali Driver']);
});
