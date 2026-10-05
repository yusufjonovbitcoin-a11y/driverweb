import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDocumentDrag, setDocumentDragData, documentDataUrl } from './documentDrag.js';

test('each document exports only its own original file, retaining filename and MIME', async () => {
  for (const id of ['rateCon', 'shipperBol', 'receiverPod', 'receipt']) {
    const mimeType = id === 'receipt' ? 'image/jpeg' : 'application/pdf';
    const fileName = `${id}${id === 'receipt' ? '.jpg' : '.pdf'}`;
    const asset = await prepareDocumentDrag({ id, versionId: `version-${id}`, url: 'https://example.test/expired' }, {
      fetchFile: async document => {
        assert.equal(document.versionId, `version-${id}`);
        return { blob: new Blob([id]), fileName, mimeType, mediaUrl: 'https://example.test/private?token=secret' };
      },
      toDataUrl: async file => `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`,
    });
    assert.equal(asset.file.name, fileName);
    assert.equal(asset.file.type, mimeType);
    assert.equal(await asset.file.text(), id);
    assert.ok(asset.dragUrl.startsWith(`data:${mimeType};base64,`));
    assert.ok(!asset.dragUrl.includes('token='));
  }
});

test('drag synchronously writes file and native download fallback as copy, not move', () => {
  const file = new File(['pdf'], 'rate.pdf', { type: 'application/pdf' });
  const files = [];
  const strings = new Map();
  const transfer = { items: { add: value => files.push(value) }, setData: (type, value) => strings.set(type, value) };
  assert.equal(setDocumentDragData(transfer, file, 'data:application/pdf;base64,cGRm'), undefined);
  assert.equal(transfer.effectAllowed, 'copy');
  assert.deepEqual(files, [file]);
  assert.equal(strings.get('DownloadURL'), 'application/pdf:rate.pdf:data:application/pdf;base64,cGRm');
  assert.equal(strings.get('text/uri-list'), 'data:application/pdf;base64,cGRm');
});

test('native fallback remains when synthetic file items are rejected', () => {
  const values = new Map();
  setDocumentDragData({ items: { add() { throw Error('unsupported'); } }, setData: (type, value) => values.set(type, value) },
    new File(['x'], 'POD.jpg', { type: 'image/jpeg' }), 'data:image/jpeg;base64,eA==');
  assert.equal(values.get('DownloadURL'), 'image/jpeg:POD.jpg:data:image/jpeg;base64,eA==');
});

test('unsafe filename separators are normalized without altering original bytes', async () => {
  const asset = await prepareDocumentDrag({ id: 'rateCon' }, {
    fetchFile: async () => ({ blob: new Blob(['original']), fileName: '../rate:con.pdf', mimeType: 'application/pdf' }),
    toDataUrl: async () => 'data:application/pdf;base64,b3JpZ2luYWw=',
  });
  assert.equal(asset.file.name, '.._rate_con.pdf');
  assert.equal(await asset.file.text(), 'original');
});

test('revoked access stops preparation without any old-link fallback', async () => {
  await assert.rejects(prepareDocumentDrag({ versionId: 'id', url: 'https://example.test/old' }, {
    fetchFile: async () => { throw Error('denied'); },
    toDataUrl: async () => assert.fail('no bytes may be exposed'),
  }), /denied/);
});

test('closing while downloading or encoding discards the pending file', async () => {
  for (const phase of ['fetch', 'encode']) {
    const controller = new AbortController();
    await assert.rejects(prepareDocumentDrag({ id: 'rateCon' }, {
      signal: controller.signal,
      fetchFile: async () => {
        if (phase === 'fetch') controller.abort();
        return { blob: new Blob(['file']), mimeType: 'application/pdf' };
      },
      toDataUrl: async () => {
        if (phase === 'fetch') assert.fail('encoding must not start');
        controller.abort(); return 'data:application/pdf;base64,ZmlsZQ==';
      },
    }), { name: 'AbortError' });
  }
});

test('FileReader cancellation rejects and a completed read returns data URL', async t => {
  const previous = globalThis.FileReader;
  t.after(() => { if (previous) globalThis.FileReader = previous; else delete globalThis.FileReader; });
  let reader;
  globalThis.FileReader = class {
    constructor() { reader = this; }
    readAsDataURL() {}
    abort() { this.onabort(); }
  };
  const controller = new AbortController();
  const pending = documentDataUrl(new Blob(['test']), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const complete = documentDataUrl(new Blob(['test']));
  reader.result = 'data:application/pdf;base64,dGVzdA==';
  reader.onload();
  assert.equal(await complete, reader.result);
});
