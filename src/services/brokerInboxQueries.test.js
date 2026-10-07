import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { brokerInboxCursor, fetchBrokerInboxRows, fetchBrokerUnreadCount } from './brokerInboxQueries.js';

function fixtureClient(tables, failureTable = null) {
  const requests = [];
  return {
    requests,
    from(table) {
      let filter;
      let limit = Infinity;
      let start = 0;
      let end = Infinity;
      const orders = [];
      return {
        select() { return this; },
        in(field, values) { filter = { field, values }; return this; },
        order(field, { ascending = true } = {}) { orders.push({ field, ascending }); return this; },
        limit(value) { limit = value; return this; },
        range(from, to) { start = from; end = to; return this; },
        then(resolve, reject) {
          requests.push({ table, filter, start, end });
          if (table === failureTable) return Promise.resolve({ error: new Error('Query failed') }).then(resolve, reject);
          const rows = [...(tables[table] || [])].filter((row) => !filter || filter.values.includes(row[filter.field]));
          rows.sort((a, b) => {
            for (const { field, ascending } of orders) {
              if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, limit)) }).then(resolve, reject);
        },
      };
    },
  };
}

test('empty Inbox does not query attachments, receipts or AI results', async () => {
  const client = fixtureClient({ broker_messages: [] });
  assert.deepEqual(await fetchBrokerInboxRows(client), []);
  assert.equal(client.requests.length, 1);
});

test('only visible message relations are loaded, joined and latest extraction retained', async () => {
  const messages = Array.from({ length: 101 }, (_, index) => ({ id: `m-${index}`, received_at: index }));
  const client = fixtureClient({
    broker_messages: messages,
    broker_attachments: [{ id: 'a-old', message_id: 'm-0' }, { id: 'a-visible', message_id: 'm-100' }],
    broker_message_reads: [{ message_id: 'm-0' }, { message_id: 'm-100' }],
    ai_extractions: [
      ...Array.from({ length: 150 }, (_, index) => ({ id: `old-${index}`, message_id: 'm-0', processed_at: 1000 + index })),
      { id: 'e-older', message_id: 'm-100', processed_at: 1 },
      { id: 'e-latest', message_id: 'm-100', processed_at: 2 },
    ],
  });
  const result = await fetchBrokerInboxRows(client);
  assert.equal(result.length, 100);
  assert.equal(result[0].id, 'm-100');
  assert.equal(result[0].is_read, true);
  assert.equal(result[0].extraction.id, 'e-latest');
  assert.deepEqual(result[0].attachments.map((row) => row.id), ['a-visible']);
  assert.equal(result[1].is_read, false);
  assert.equal(result[1].extraction, null);
  for (const request of client.requests.slice(1)) {
    assert.equal(request.filter.field, 'message_id');
    assert.equal(request.filter.values.length, 100);
    assert.equal(request.filter.values.includes('m-0'), false);
  }
});

test('related rows are paginated without losing attachments beyond the API page size', async () => {
  const client = fixtureClient({
    broker_messages: [{ id: 'm-1', received_at: 1 }],
    broker_attachments: Array.from({ length: 1201 }, (_, index) => ({
      id: `a-${index}`, message_id: 'm-1', created_at: index,
    })),
  });
  const [message] = await fetchBrokerInboxRows(client);
  assert.equal(message.attachments.length, 1201);
  assert.equal(message.attachments.at(-1).id, 'a-1200');
  assert.deepEqual(client.requests.filter((row) => row.table === 'broker_attachments').map((row) => row.start), [0, 500, 1000]);
});

test('failed message or relation queries are reported rather than showing partial success', async () => {
  for (const table of ['broker_messages', 'broker_attachments', 'ai_extractions', 'broker_message_reads']) {
    const client = fixtureClient({ broker_messages: [{ id: 'm-1' }] }, table);
    await assert.rejects(fetchBrokerInboxRows(client), /Query failed/);
  }
});

test('unread badge asks the server for all matching messages without downloading rows', async () => {
  let calls = 0;
  const client = createClient('https://example.supabase.co', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      calls += 1;
      const url = new URL(input);
      assert.equal(init.method, 'HEAD');
      assert.equal(new Headers(init.headers).get('prefer'), 'count=exact');
      assert.match(url.searchParams.get('select'), /broker_attachments_message_company_fk!inner/);
      assert.equal(url.searchParams.get('reads'), 'is.null');
      assert.match(url.searchParams.get('attachments.or'), /mime_type.eq.application\/pdf/);
      assert.match(url.searchParams.get('attachments.or'), /file_name.ilike.\*\.jpeg/);
      assert.equal(url.searchParams.has('limit'), false);
      return new Response(null, { status: 200, headers: { 'content-range': '0-999/2500' } });
    } },
  });
  assert.equal(await fetchBrokerUnreadCount(client), 2500);
  assert.equal(calls, 1);
});

test('failed or missing unread counts do not silently reset the badge to zero', async () => {
  for (const result of [{ error: new Error('Offline') }, { count: null }]) {
    const query = { select() { return this; }, is() { return this; }, or() { return Promise.resolve(result); } };
    await assert.rejects(fetchBrokerUnreadCount({ from: () => query }));
  }
});

test('older pages use stable timestamp/id cursors and join their own attachments', async () => {
  const newestId = '00000000-0000-0000-0000-000000000100';
  const oldestId = '00000000-0000-0000-0000-000000000001';
  const at = '2026-10-06T12:00:00.123456+00:00';
  let messageRequests = 0;
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(input); let rows = [];
      if (url.pathname.endsWith('/broker_messages')) {
        messageRequests++;
        assert.equal(url.searchParams.get('limit'), '100');
        if (messageRequests === 1) {
          assert.equal(url.searchParams.has('or'), false);
          rows = [{ id: newestId, received_at: at }];
        } else {
          assert.equal(url.searchParams.get('or'), `(received_at.lt.${at},and(received_at.eq.${at},id.lt.${newestId}))`);
          rows = [{ id: oldestId, received_at: at }];
        }
      } else if (url.pathname.endsWith('/broker_attachments')) {
        const expected = messageRequests === 1 ? newestId : oldestId;
        assert.equal(url.searchParams.get('message_id'), `in.(${expected})`);
        rows = [{ id: `pdf-${expected}`, message_id: expected }];
      }
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  const first = await fetchBrokerInboxRows(client);
  const older = await fetchBrokerInboxRows(client, brokerInboxCursor(first));
  assert.equal(older[0].id, oldestId); assert.equal(older[0].attachments.length, 1);
  await assert.rejects(fetchBrokerInboxRows(client, { id: 'bad),id.neq.x', receivedAt: at }), /Invalid inbox cursor/);
});
