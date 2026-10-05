// Run: node scripts/preview-load-trash.mjs
// Open: http://127.0.0.1:5187/
// Uses the real trash components with in-memory fixtures. No App, auth, Supabase,
// project environment files, API proxy or remote document URL is loaded.
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, transformWithOxc } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'load-trash-preview-vite-'));
const entryPath = '/__load-trash-preview.jsx';
const entryId = '\0load-trash-preview.jsx';
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Load trash UI fixture</title></head>
<body><div id="root"></div><script type="module" src="${entryPath}"></script></body></html>`;

const fixtureSource = String.raw`
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoadTrashPanel from '/src/components/LoadTrashPanel.jsx';
import LoadTrashAction from '/src/components/LoadTrashAction.jsx';
import { setAppLocale } from '/src/i18n/index.js';
import '/src/index.css';
import '/src/components/loadDetails.css';

await setAppLocale('en', { persist: false });

const drivers = [
  { id: 'driver-alpha', name: 'Fixture Driver Alpha', driverNumber: 'D-100', accountStatus: 'active', status: 'AVAILABLE' },
  { id: 'driver-beta', name: 'Fixture Driver Beta', driverNumber: 'D-200', accountStatus: 'active', status: 'AVAILABLE' },
  { id: 'driver-suspended', name: 'Suspended Fixture Driver', driverNumber: 'D-300', accountStatus: 'suspended', status: 'SUSPENDED' },
];
const seed = {
  active: [{
    id: 'active-1', loadNumber: 'ACTIVE-1', status: 'ON_ROAD', driverId: 'driver-alpha',
    origin: { city: 'Chicago', state: 'IL' }, destination: { city: 'Columbus', state: 'OH' },
    documents: [{ id: 'active-1-pdf', name: 'ACTIVE-1-rate-confirmation.pdf', source: 'fixture-only' }],
    tripHistory: [{ id: 'active-1-history', event: 'Original trip in progress', driverId: 'driver-alpha' }],
  }],
  trash: [{
    id: 'trash-1', loadNumber: 'TRASH-1', status: 'ON_ROAD', trashedDriverId: 'driver-alpha', trashedAt: '2026-10-06T09:00:00.000Z',
    origin: { city: 'New York', state: 'NY' }, destination: { city: 'Boston', state: 'MA' },
    documents: [{ id: 'trash-1-pdf', name: 'TRASH-1-rate-confirmation.pdf', source: 'fixture-only' }],
    tripHistory: [{ id: 'trash-1-history', event: 'Previous trip retained', driverId: 'driver-alpha' }],
  }, {
    id: 'trash-2', loadNumber: 'TRASH-2', status: 'UNASSIGNED', trashedDriverId: null, trashedAt: '2026-10-05T12:30:00.000Z',
    origin: { city: 'Dallas', state: 'TX' }, destination: { city: 'Denver', state: 'CO' },
    documents: [{ id: 'trash-2-pdf', name: 'TRASH-2-rate-confirmation.pdf', source: 'fixture-only' }],
    tripHistory: [],
  }],
};

function Fixture() {
  const [data, setData] = useState(() => structuredClone(seed));
  const [log, setLog] = useState([]);
  const [pending, setPending] = useState(0);
  const [panelBusy, setPanelBusy] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [delay, setDelay] = useState(1500);
  const [isDark, setIsDark] = useState(false);
  const [locale, setLocale] = useState('en');
  const [generation, setGeneration] = useState(0);
  const [selectedActiveId, setSelectedActiveId] = useState('active-1');
  const [documentLoad, setDocumentLoad] = useState(null);
  const failNextRef = useRef(false);
  const sequence = useRef(0);
  const selectedActive = data.active.find(load => load.id === selectedActiveId) || data.active[0];
  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);
  const appendLog = message => setLog(previous => [...previous, message]);
  const fakeRequest = async (kind, load, driverId = null) => {
    const number = ++sequence.current;
    const fail = failNextRef.current;
    failNextRef.current = false;
    setFailNext(false);
    appendLog(number + ': REQUEST ' + kind + ' ' + load.loadNumber + (kind === 'restore' ? ' driver=' + (driverId || 'unassigned') : ''));
    setPending(previous => previous + 1);
    try {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (fail) {
        appendLog(number + ': REJECT ' + kind + ' ' + load.loadNumber);
        throw new Error('Synthetic fixture failure');
      }
      setData(previous => {
        if (kind === 'move') return {
          active: previous.active.filter(item => item.id !== load.id),
          trash: [...previous.trash, { ...load, driverId: null, trashedDriverId: load.driverId || null, trashedAt: new Date().toISOString() }],
        };
        if (kind === 'restore') return {
          trash: previous.trash.filter(item => item.id !== load.id),
          active: [...previous.active, { ...load, trashedAt: null, trashedDriverId: null, driverId, status: driverId ? 'ASSIGNED' : 'UNASSIGNED' }],
        };
        return { ...previous, trash: previous.trash.filter(item => item.id !== load.id) };
      });
      appendLog(number + ': RESOLVE ' + kind + ' ' + load.loadNumber);
    } finally {
      setPending(previous => previous - 1);
    }
  };
  const reset = () => {
    if (pending) return;
    setData(structuredClone(seed)); setLog([]); setDocumentLoad(null); setSelectedActiveId('active-1');
    failNextRef.current = false; setFailNext(false); setPanelBusy(false); sequence.current = 0;
    setGeneration(previous => previous + 1);
  };

  return <main className="trash-fixture workspace-shell">
    <style>{
      '.trash-fixture{height:auto;min-height:100dvh;max-width:1280px;margin:auto;padding:24px;color:var(--ink)}' +
      '.fixture-title{font-size:24px;font-weight:650;margin:0 0 8px}.fixture-note{color:var(--muted);font-size:13px;line-height:1.6}' +
      '.fixture-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:20px 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}' +
      '.fixture-controls button,.fixture-controls select,.fixture-active select{padding:7px 11px;border:1px solid var(--line);border-radius:6px;background:var(--canvas);color:var(--ink);font-size:12px}' +
      '.fixture-controls label{display:inline-flex;align-items:center;gap:7px;font-size:12px}.fixture-controls input[type=checkbox]{accent-color:var(--accent)}' +
      '.fixture-controls button:disabled{opacity:.5}.fixture-status{margin-left:auto;font-size:12px;font-weight:650}' +
      '.fixture-active{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}' +
      '.fixture-active h2{font-size:15px;font-weight:650;margin-right:auto}.fixture-active-list{flex-basis:100%;margin:0;padding:0;list-style:none;font-size:12px;color:var(--muted)}' +
      '.fixture-panel{height:min(630px,80vh);min-height:380px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}' +
      '.fixture-document,.fixture-log,.fixture-state{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}' +
      '.fixture-log h2,.fixture-document h2{font-size:15px;font-weight:650;margin:0 0 8px}.fixture-log ol{margin:0;padding-left:22px;font-size:12px;font-family:monospace}' +
      '.fixture-state pre{overflow:auto;font-size:11px;max-height:350px}.fixture-state summary{cursor:pointer;font-weight:600;font-size:13px}.fixture-document p{font-size:12px;color:var(--muted)}' +
      '@media(max-width:600px){.trash-fixture{padding:12px}.fixture-panel{height:700px;padding:12px}.fixture-status{width:100%;margin:0}}'
    }</style>
    <h1 className="fixture-title">Load trash UI fixture</h1>
    <p className="fixture-note">Synthetic loads only. Mutations resolve after the selected delay. “Fail next action” rejects one request without changing fixture records. Documents are represented by local metadata; no backend, authentication or file fetch is used.</p>
    <section className="fixture-controls" aria-label="Fixture controls">
      <button type="button" onClick={reset} disabled={pending > 0}>Reset fixture</button>
      <button type="button" onClick={() => setIsDark(previous => !previous)}>{isDark ? 'Switch to light' : 'Switch to dark'}</button>
      <label>Language<select aria-label="Fixture language" value={locale} onChange={event => { setLocale(event.target.value); setAppLocale(event.target.value, { persist: false }); }}>
        <option value="en">English</option><option value="uz">O‘zbekcha</option><option value="ru">Русский</option>
      </select></label>
      <label>Delay<select aria-label="Fixture request delay" value={delay} disabled={pending > 0} onChange={event => setDelay(Number(event.target.value))}>
        <option value={1500}>1.5 seconds</option><option value={4000}>4 seconds</option><option value={8000}>8 seconds</option>
      </select></label>
      <label><input type="checkbox" checked={failNext} disabled={pending > 0} onChange={event => { failNextRef.current = event.target.checked; setFailNext(event.target.checked); }} />Fail next action</label>
      <output className="fixture-status" id="fixture-pending" aria-live="polite">Pending: {pending} · Panel busy: {String(panelBusy)}</output>
    </section>
    <section className="fixture-active" aria-label="Active fixture loads">
      <h2>Active loads: {data.active.length}</h2>
      {selectedActive ? <>
        <select aria-label="Active fixture load" value={selectedActive.id} disabled={pending > 0} onChange={event => setSelectedActiveId(event.target.value)}>
          {data.active.map(load => <option key={load.id} value={load.id}>{load.loadNumber}</option>)}
        </select>
        <LoadTrashAction key={generation + '-' + selectedActive.id} load={selectedActive} onTrashLoad={load => fakeRequest('move', load)} />
      </> : <p className="fixture-note">No active loads. Restore a load below or reset the fixture.</p>}
      <ul className="fixture-active-list" id="fixture-active-loads">{data.active.map(load => <li key={load.id}>{load.loadNumber} · {load.status} · {load.driverId || 'unassigned'} · PDFs: {load.documents.length} · Historical records: {load.tripHistory.length}</li>)}</ul>
    </section>
    <section className="fixture-panel" aria-label="Real trash panel">
      <LoadTrashPanel key={generation} loads={data.trash} drivers={drivers} onBusyChange={setPanelBusy}
        onRestoreLoad={(load, driverId) => fakeRequest('restore', load, driverId)}
        onPermanentlyDeleteLoad={load => fakeRequest('delete', load)}
        onOpenDocs={load => { appendLog('DOCUMENTS ' + load.loadNumber); setDocumentLoad(load); }} />
    </section>
    {documentLoad && <section className="fixture-document" id="fixture-document-preview" role="status">
      <h2>Documents requested: {documentLoad.loadNumber}</h2>
      <p>{documentLoad.documents.map(document => document.name).join(', ')}</p>
      <p>Historical records retained: {documentLoad.tripHistory.length}. This fixture displays metadata only.</p>
    </section>}
    <section className="fixture-log" aria-label="Fixture action log">
      <h2>Action log</h2><ol id="fixture-action-log" aria-live="polite">{log.length ? log.map((item, index) => <li key={index}>{item}</li>) : <li>No actions yet</li>}</ol>
    </section>
    <details className="fixture-state"><summary>Inspect in-memory records</summary><pre id="fixture-state">{JSON.stringify(data, null, 2)}</pre></details>
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
`;

const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  envDir: false,
  publicDir: false,
  appType: 'custom',
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [tailwindcss(), {
    name: 'load-trash-preview-fixture',
    resolveId(source) { if (source === entryPath) return entryId; },
    load(id) { if (id === entryId) return transformWithOxc(fixtureSource, 'load-trash-preview.jsx', { jsx: { runtime: 'automatic' } }); },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:5187; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'");
        if (pathname?.startsWith('/api/') || pathname?.startsWith('/rest/') || pathname?.startsWith('/auth/')) {
          response.writeHead(403, { 'Content-Type': 'text/plain' });
          response.end('Backend requests are disabled in the trash fixture.');
          return;
        }
        if (pathname !== '/') { next(); return; }
        try {
          const transformed = await vite.transformIndexHtml('/', html);
          response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          response.end(transformed);
        } catch (error) { next(error); }
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5187, strictPort: true, allowedHosts: ['127.0.0.1'], open: false, hmr: false, watch: null },
});

await server.listen();
console.log('Load trash fixture: http://127.0.0.1:5187/ — synthetic data only; env files and backend disabled.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
