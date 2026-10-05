// Local-only synthetic fixture: no backend, authentication, or real chat data.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import '../src/index.css';
import ChatTimeline from '../src/components/ChatTimeline';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: { chat: { latestMessages: 'Latest messages' } } } }, interpolation: { escapeValue: false } });
const makeRows = (start, count) => Array.from({ length: count }, (_, offset) => ({
  id: `fixture-${start + offset}`, number: start + offset,
  body: `Synthetic message ${start + offset} — ${'Variable-height chat content. '.repeat((start + offset) % 4 + 1)}`,
}));
const buttonStyle = { padding: '7px 12px', border: '1px solid #94a3b8', borderRadius: 6, background: 'white', color: '#0f172a' };

export default function Fixture() {
  const [messages, setMessages] = useState(() => makeRows(400, 100));
  const [isVisible, setVisible] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderRequests, setOlderRequests] = useState(0);
  const [expandedMedia, setExpandedMedia] = useState(false);
  const [mediaStatus, setMediaStatus] = useState('compact');
  const [compactViewport, setCompactViewport] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const pendingOlder = useRef(false);
  const rowsRef = useRef(messages);
  useLayoutEffect(() => { rowsRef.current = messages; }, [messages]);
  const loadOlder = async () => {
    if (pendingOlder.current || rowsRef.current[0].number <= 0) return;
    pendingOlder.current = true;
    setLoadingOlder(true);
    setOlderRequests((count) => count + 1);
    await new Promise((resolve) => setTimeout(resolve, 350));
    setMessages((rows) => {
      const first = rows[0].number;
      const count = Math.min(50, first);
      return [...makeRows(first - count, count), ...rows].slice(-500);
    });
    pendingOlder.current = false;
    setLoadingOlder(false);
  };
  const latest = async () => {
    setMessages(makeRows(400, 100));
  };
  return <I18nextProvider i18n={i18n}>
    <main style={{ height: '100dvh', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#f1f5f9', color: '#0f172a' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Real ChatTimeline / Virtuoso — synthetic local fixture</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button style={buttonStyle} onClick={() => setVisible((value) => !value)}>{isVisible ? 'Hide chat' : 'Show chat'}</button>
        <button style={buttonStyle} onClick={loadOlder} disabled={loadingOlder || messages[0].number === 0}>Prepend 50 older</button>
        <button style={buttonStyle} onClick={latest}>Replace with latest 100</button>
        <button style={buttonStyle} onClick={() => setMessages((rows) => rows.length > 1 ? rows.slice(1) : rows)}>Delete first row</button>
        <button style={buttonStyle} onClick={() => {
          setExpandedMedia(false); setMediaStatus('waiting 1500ms');
          setTimeout(() => { setExpandedMedia(true); setMediaStatus('expanded'); }, 1500);
        }}>Late media resize</button>
        <button style={buttonStyle} onClick={() => setCompactViewport((value) => !value)}>Resize viewport</button>
      </div>
      <output style={{ fontFamily: 'monospace', fontSize: 13 }}>
        Loaded: {messages.length} | Older requests: {olderRequests} | Loading older: {String(loadingOlder)} | Range: {messages[0].number}–{messages.at(-1).number} | Media: {mediaStatus}
      </output>
      <output style={{ fontFamily: 'monospace', fontSize: 13 }}>
        Saved anchor: {snapshot?.anchorId || 'none'} | At bottom: {String(snapshot?.atBottom ?? false)} | Offset: {Math.round(snapshot?.offset || 0)}
      </output>
      <section style={{ display: isVisible ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 0', minHeight: 0, maxHeight: compactViewport ? 360 : undefined, border: '1px solid #94a3b8', background: '#eaf2f6', overflow: 'hidden' }}>
        <ChatTimeline messages={messages} isVisible={isVisible} restoreState={snapshot} onSaveState={setSnapshot}
          hasOlderMessages={messages[0].number > 0} loadingOlder={loadingOlder} onLoadOlder={loadOlder} onLatest={latest}>
          {(message) => <article data-fixture-message={message.number} style={{ marginLeft: message.number % 2 ? '15%' : 0, marginRight: message.number % 2 ? 0 : '15%', padding: 12, borderRadius: 10, background: 'white', border: '1px solid #cbd5e1' }}>
            <strong>Message {message.number}</strong><p>{message.body}</p>
            {message.number === 499 && <div aria-label="Synthetic delayed media" style={{ height: expandedMedia ? 460 : 40, marginTop: 8, background: '#0f766e', color: 'white', padding: 10 }}>Synthetic media — {expandedMedia ? '460px' : '40px'}</div>}
          </article>}
        </ChatTimeline>
      </section>
      {!isVisible && <p>Chat hidden. Show it again to verify cached restoration.</p>}
    </main>
  </I18nextProvider>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
