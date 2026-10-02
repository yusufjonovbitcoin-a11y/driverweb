// Development-only deterministic fixture. No backend/authentication or real messages.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/i18n';
import '../src/index.css';
import ChatTimeline from '../src/components/ChatTimeline';
export default function Fixture() {
  const [messages, setMessages] = useState(() => Array.from({ length: 10000 }, (_, i) => ({ id: `${i + 100}`, body: `Fixture message ${i + 100}` })));
  return <main style={{ height: '95vh', display: 'flex', flexDirection: 'column' }}>
    <h1>Chat timeline: {messages.length} messages</h1>
    <button onClick={() => setMessages((rows) => [...Array.from({ length: 50 }, (_, i) => ({ id: `${Number(rows[0].id) - 50 + i}`, body: `Older message ${Number(rows[0].id) - 50 + i}` })), ...rows])}>Prepend 50</button>
    <button onClick={() => setMessages((rows) => [...rows, { id: `${Number(rows.at(-1).id) + 1}`, body: 'New arrival' }])}>Append message</button>
    <ChatTimeline messages={messages}>{(message) => <p data-fixture-message style={{ padding: 12 }}>{message.body}</p>}</ChatTimeline>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
