import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTripDocument, resolveTripDocumentSource, saveDocumentBlob } from './tripDocumentAccess.js';

test('download resolves fresh URL on every action and preserves original bytes/name', async () => {
  let calls = 0;
  const fetched = [];
  const options = {
    resolveSource: async () => ({ mediaUrl: `https://example.test/fresh-${++calls}`, fileName: 'rate.pdf', mimeType: 'application/pdf' }),
    fetchDocument: async url => { fetched.push(url); return new Response('%PDF-original'); },
  };
  for (let i = 0; i < 2; i++) {
    const result = await fetchTripDocument({ versionId: 'version', url: 'https://example.test/expired' }, options);
    assert.equal(result.fileName, 'rate.pdf');
    assert.equal(await result.blob.text(), '%PDF-original');
  }
  assert.deepEqual(fetched, ['https://example.test/fresh-1', 'https://example.test/fresh-2']);
});

test('expired URL automatically reauthorizes once before fetching again', async () => {
  let signed = 0;
  const result = await fetchTripDocument({ versionId: 'version' }, {
    resolveSource: async () => ({ mediaUrl: `https://example.test/${++signed}` }),
    fetchDocument: async () => signed === 1 ? new Response('InvalidJWT', { status: 400 }) : new Response('file'),
  });
  assert.equal(signed, 2);
  assert.equal(await result.blob.text(), 'file');
});

test('denied renewal never falls back to cached URL', async () => {
  let fetches = 0;
  let resolves = 0;
  await assert.rejects(fetchTripDocument({ versionId: 'version', url: 'https://example.test/old' }, {
    resolveSource: async () => { if (++resolves === 2) throw Error('access denied'); return { mediaUrl: 'https://example.test/first' }; },
    fetchDocument: async () => { fetches++; return new Response('', { status: 403 }); },
  }), /access denied/);
  assert.equal(fetches, 1);
});

test('repeated failure is bounded, non-auth failure is not retried', async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    let count = 0;
    await assert.rejects(fetchTripDocument({ versionId: 'version' }, {
      resolveSource: async () => ({ mediaUrl: 'https://example.test/file' }),
      fetchDocument: async () => { count++; return new Response('', { status }); },
    }), new RegExp(`DOCUMENT_DOWNLOAD_FAILED_${status}`));
    assert.equal(count, [400, 401, 403].includes(status) ? 2 : 1);
  }
});

test('closing document during renewal prevents the fetch', async () => {
  const controller = new AbortController();
  await assert.rejects(fetchTripDocument({ versionId: 'version' }, {
    signal: controller.signal,
    resolveSource: async () => { controller.abort(); return { mediaUrl: 'https://example.test/file' }; },
    fetchDocument: async () => assert.fail('closed viewer must not download'),
  }), { name: 'AbortError' });
});

test('legacy preview with no durable version retains its original source', async () => {
  const source = await resolveTripDocumentSource({ url: 'blob:preview', fileName: 'local.pdf', mimeType: 'application/pdf' });
  assert.equal(source.mediaUrl, 'blob:preview');
  await assert.rejects(resolveTripDocumentSource({}), /DOCUMENT_UNAVAILABLE/);
});

test('download uses a local blob, preserves filename, removes link and revokes URL', () => {
  const blob = new Blob(['original']);
  const events = [];
  const link = { click() { events.push('clicked'); }, remove() { events.push('removed'); } };
  saveDocumentBlob(blob, 'rate.pdf', {
    dom: { createElement: () => link, body: { appendChild: () => events.push('attached') } },
    urls: { createObjectURL: value => { assert.equal(value, blob); return 'blob:test'; }, revokeObjectURL: value => events.push(value) },
    schedule: (callback, ms) => { assert.equal(ms, 60000); callback(); },
  });
  assert.equal(link.href, 'blob:test');
  assert.equal(link.download, 'rate.pdf');
  assert.deepEqual(events, ['attached', 'clicked', 'removed', 'blob:test']);
});
