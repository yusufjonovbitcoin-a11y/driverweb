import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Inbox, LoaderCircle, Mail } from 'lucide-react';
import { fetchBrokerInbox } from '../services/operationsService';

const statusLabels = {
  queued: 'Navbatda',
  processing: 'AI tekshirmoqda',
  extracted: 'Tayyor',
  needs_review: 'Tekshirish kerak',
  parse_failed: 'O‘qib bo‘lmadi',
};

function StatusIcon({ status }) {
  if (status === 'extracted') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === 'needs_review' || status === 'parse_failed') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <LoaderCircle className="w-4 h-4 text-blue-500" />;
}

export default function BrokerInbox({ onCreateLoad }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let active = true;
    fetchBrokerInbox()
      .then((data) => {
        if (!active) return;
        setItems(data);
        setSelectedId(data[0]?.id || null);
      })
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const selected = items.find((item) => item.id === selectedId) || null;

  if (loading) {
    return <div className="h-72 flex items-center justify-center"><LoaderCircle className="w-7 h-7 animate-spin text-zinc-500" /></div>;
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 min-h-[calc(100vh-7rem)]">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-black text-lg flex items-center gap-2"><Inbox className="w-5 h-5" /> Broker xabarlari</h2>
          <p className="text-xs text-zinc-500 mt-1">Kompaniya Gmail hisobidan kelgan rate confirmationlar</p>
        </div>
        {error && <div className="m-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
        {items.length === 0 ? (
          <div className="p-10 text-center text-zinc-500">
            <Mail className="w-9 h-9 mx-auto mb-3 text-zinc-300" />
            <p className="font-bold text-zinc-700 dark:text-zinc-200">Hozircha broker xabari yo‘q</p>
            <p className="text-xs mt-1">Gmail worker yangi xabarlarni shu yerga olib keladi.</p>
          </div>
        ) : items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            className={`w-full text-left px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 transition-colors ${selectedId === item.id ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-sm truncate">{item.subject || 'Mavzusiz xabar'}</span>
              <StatusIcon status={item.status} />
            </div>
            <p className="text-xs text-zinc-500 truncate mt-1">{item.from_email}</p>
            <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-400">
              <span>{statusLabels[item.status] || item.status}</span>
              <span>{new Date(item.received_at).toLocaleString('uz-UZ')}</span>
            </div>
          </button>
        ))}
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <Bot className="w-10 h-10 mb-3" />
            <p>Xabarni tanlang</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wide"><Bot className="w-4 h-4" /> AI tahlili</div>
                <h3 className="text-xl font-black mt-2">{selected.subject || 'Broker xabari'}</h3>
                <p className="text-sm text-zinc-500 mt-1">{selected.from_email}</p>
              </div>
              <span className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-bold">{statusLabels[selected.status] || selected.status}</span>
            </div>

            {selected.extraction?.result ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(selected.extraction.result).map(([key, value]) => (
                  <div key={key} className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500 font-bold">{key}</p>
                    <p className="text-sm font-semibold mt-1 break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center text-zinc-500">
                AI natijasi hali tayyor emas.
              </div>
            )}

            <button
              onClick={() => onCreateLoad?.(selected)}
              disabled={!selected.extraction?.result}
              className="px-5 py-2.5 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-bold text-sm disabled:opacity-40"
            >
              Load sifatida ko‘rib chiqish
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
