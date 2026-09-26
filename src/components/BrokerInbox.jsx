import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Bot, CheckCircle2, FileText, Inbox, LoaderCircle,
  Mail, Paperclip, Send, Star,
} from 'lucide-react';
import { fetchBrokerInbox, forwardGmailAttachmentToDriver, markBrokerMessageRead } from '../services/operationsService';

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
  return <LoaderCircle className={`w-4 h-4 text-blue-500 ${status === 'processing' ? 'animate-spin' : ''}`} />;
}

function senderLabel(email = '') {
  const localPart = email.split('@')[0] || 'Noma’lum';
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInboxTime(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  }
  const months = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function messagePreview(item) {
  const proposal = item.extraction?.result;
  const origin = [proposal?.origin?.city, proposal?.origin?.state].filter(Boolean).join(', ');
  const destination = [proposal?.destination?.city, proposal?.destination?.state].filter(Boolean).join(', ');
  if (origin || destination) return `${origin || 'Pickup'} → ${destination || 'Delivery'}`;
  if (item.error_message) return item.error_message;
  if (item.attachments?.length) return `${item.attachments.length} ta biriktirma`;
  return statusLabels[item.status] || 'Gmail xabari';
}

function ProposalPreview({ proposal }) {
  const origin = [proposal.origin?.city, proposal.origin?.state].filter(Boolean).join(', ') || 'Pickup aniqlanmadi';
  const destination = [proposal.destination?.city, proposal.destination?.state].filter(Boolean).join(', ') || 'Delivery aniqlanmadi';
  return (
    <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">AI tayyorlagan taklif</p>
          <h4 className="mt-1 text-lg font-black">{origin} → {destination}</h4>
          <p className="mt-1 text-xs text-zinc-500">{proposal.loadNumber || 'Load raqami aniqlanmadi'} · {proposal.broker || 'Broker aniqlanmadi'}</p>
        </div>
        <p className="text-xl font-black">${Number(proposal.rate || 0).toLocaleString()}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div><p className="text-xs text-zinc-500">Texnika</p><p className="font-bold">{proposal.equipment || '—'}</p></div>
        <div><p className="text-xs text-zinc-500">Masofa</p><p className="font-bold">{proposal.distanceMiles ? `${proposal.distanceMiles} mi` : '—'}</p></div>
        <div><p className="text-xs text-zinc-500">Og‘irlik</p><p className="font-bold">{proposal.weightLbs ? `${Number(proposal.weightLbs).toLocaleString()} lbs` : '—'}</p></div>
        <div><p className="text-xs text-zinc-500">Ishonchlilik</p><p className="font-bold">{proposal.confidence != null ? `${Math.round(Number(proposal.confidence) * 100)}%` : '—'}</p></div>
      </div>
      {proposal.missingFields?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Tekshirish kerak: {proposal.missingFields.join(', ')}
        </div>
      )}
    </div>
  );
}

export default function BrokerInbox({ drivers, onCreateLoad, onUnreadChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [forwardingAttachmentId, setForwardingAttachmentId] = useState(null);
  const [forwardMessage, setForwardMessage] = useState('');

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async (initial = false) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchBrokerInbox();
        if (!active) return;
        setItems(data);
        setSelectedId((current) => data.some((item) => item.id === current) ? current : null);
        setError('');
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        inFlight = false;
        if (active && initial) setLoading(false);
      }
    };
    refresh(true);
    const intervalId = window.setInterval(() => refresh(false), 15_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const selected = items.find((item) => item.id === selectedId) || null;
  const availableDrivers = drivers.filter((driver) => driver.status !== 'SUSPENDED');

  useEffect(() => {
    if (!selected || selected.is_read || !selected.attachments?.length) return;
    let active = true;
    markBrokerMessageRead(selected.id).then(() => {
      if (!active) return;
      setItems((current) => current.map((item) => (
        item.id === selected.id ? { ...item, is_read: true } : item
      )));
      onUnreadChange?.();
    }).catch(() => {});
    return () => { active = false; };
  }, [selected, onUnreadChange]);

  const forwardAttachment = async (attachment) => {
    if (!selectedDriverId) {
      setForwardMessage('Avval driverni tanlang.');
      return;
    }
    setForwardingAttachmentId(attachment.id);
    setForwardMessage('');
    try {
      await forwardGmailAttachmentToDriver({ attachmentId: attachment.id, driverId: selectedDriverId });
      const driver = availableDrivers.find((item) => item.id === selectedDriverId);
      setForwardMessage(`${attachment.file_name} ${driver?.name || 'driver'} chatiga yuborildi.`);
    } catch (forwardError) {
      setForwardMessage(forwardError.message || 'PDF faylni driverga yuborib bo‘lmadi.');
    } finally {
      setForwardingAttachmentId(null);
    }
  };

  if (loading) {
    return <div className="h-72 flex items-center justify-center"><LoaderCircle className="w-7 h-7 animate-spin text-zinc-500" /></div>;
  }

  if (selected) {
    const pdfAttachments = selected.attachments?.filter((attachment) => (
      attachment.mime_type === 'application/pdf' || attachment.file_name?.toLowerCase().endsWith('.pdf')
    )) || [];

    return (
      <div className="broker-inbox-workspace min-h-full bg-white dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Inboxga qaytish
          </button>
        </div>

        <article className="mx-auto max-w-5xl space-y-6 px-5 py-6 sm:px-8">
          <header className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-black tracking-tight text-zinc-950 dark:text-white">
                  {selected.subject || 'Mavzusiz xabar'}
                </h2>
                <div className="mt-4 flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-700 text-sm font-black text-white">
                    {senderLabel(selected.from_email).charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{senderLabel(selected.from_email)}</p>
                    <p className="truncate text-xs text-zinc-500">{selected.from_email}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <time className="block text-xs font-medium text-zinc-500">
                  {new Date(selected.received_at).toLocaleString('uz-UZ')}
                </time>
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  <StatusIcon status={selected.status} />
                  {statusLabels[selected.status] || selected.status}
                </span>
              </div>
            </div>

            {selected.attachments?.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {selected.attachments.map((attachment) => (
                  <span key={attachment.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    <FileText className={`h-4 w-4 shrink-0 ${attachment.mime_type === 'application/pdf' ? 'text-red-500' : 'text-blue-500'}`} />
                    <span className="truncate">{attachment.file_name}</span>
                    {attachment.size_bytes && <span className="text-zinc-400">{Math.ceil(attachment.size_bytes / 1024)} KB</span>}
                  </span>
                ))}
              </div>
            )}
          </header>

          <section className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
              <Bot className="h-4 w-4" /> AI tahlili
            </div>
            <div className="mt-4">
              {selected.extraction?.result && Object.keys(selected.extraction.result).length > 0 ? (
                <ProposalPreview proposal={selected.extraction.result} />
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                  {selected.status === 'processing' ? 'AI xabarni tahlil qilmoqda…' : 'Bu xatda tayyor AI taklifi yo‘q.'}
                </div>
              )}
            </div>
          </section>

          {selected.error_message && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{selected.error_message}</span>
            </div>
          )}

          <section className="space-y-3 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div>
              <h3 className="text-sm font-black">PDF’ni driverga yuborish</h3>
              <p className="mt-1 text-xs text-zinc-500">Driverni dispecher tanlaydi. Fayl uning chatiga yuboriladi.</p>
            </div>
            <select
              value={selectedDriverId}
              onChange={(event) => { setSelectedDriverId(event.target.value); setForwardMessage(''); }}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="PDF yuboriladigan driver"
            >
              <option value="">Driverni tanlang</option>
              {availableDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </select>
            {pdfAttachments.map((attachment) => (
              <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-5 w-5 shrink-0 text-red-500" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{attachment.file_name}</p>
                    <p className="text-xs text-zinc-500">{attachment.size_bytes ? `${Math.ceil(attachment.size_bytes / 1024)} KB` : 'Hajmi noma’lum'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!selectedDriverId || forwardingAttachmentId === attachment.id}
                  onClick={() => forwardAttachment(attachment)}
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950"
                >
                  {forwardingAttachmentId === attachment.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Driverga yuborish
                </button>
              </div>
            ))}
            {pdfAttachments.length === 0 && <p className="text-sm text-zinc-500">Bu xatga PDF biriktirilmagan.</p>}
            {forwardMessage && <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{forwardMessage}</p>}
          </section>

          <button
            type="button"
            onClick={() => onCreateLoad?.(selected)}
            disabled={!selected.extraction?.result || Object.keys(selected.extraction.result).length === 0}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-950"
          >
            Taklifni ko‘rib chiqish
          </button>
        </article>
      </div>
    );
  }

  return (
    <div className="broker-inbox-workspace min-h-full bg-white dark:bg-zinc-900">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black"><Inbox className="h-5 w-5" /> Broker Inbox</h2>
            <p className="mt-1 text-xs text-zinc-500">Gmail xatlari, PDF hujjatlar va AI tayyorlagan takliflar</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {items.length} ta xabar
          </span>
        </div>
        {error && <div className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {items.length === 0 ? (
          <div className="p-10 text-center text-zinc-500">
            <Mail className="mx-auto mb-3 h-9 w-9 text-zinc-300" />
            <p className="font-bold text-zinc-700 dark:text-zinc-200">Hozircha broker xabari yo‘q</p>
            <p className="mt-1 text-xs">IMAP ulangach yangi Gmail xatlari shu yerga keladi.</p>
          </div>
        ) : (
          <div aria-label="Broker xatlari">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setForwardMessage(''); }}
                className={`grid w-full grid-cols-[18px_18px_minmax(110px,170px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-zinc-200 px-4 py-2.5 text-left transition-colors dark:border-zinc-800 sm:gap-3 sm:px-6 ${
                  item.is_read
                    ? 'bg-zinc-50/70 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                    : 'bg-white font-bold hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900'
                }`}
                aria-label={`${senderLabel(item.from_email)}: ${item.subject || 'Mavzusiz xabar'}`}
              >
                <span aria-hidden="true" className="h-3.5 w-3.5 rounded-sm border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900" />
                <Star aria-hidden="true" className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
                <span className="truncate text-sm text-zinc-800 dark:text-zinc-200">{senderLabel(item.from_email)}</span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">{item.subject || 'Mavzusiz xabar'}</span>
                    <span className="hidden truncate text-sm font-normal text-zinc-500 md:inline">– {messagePreview(item)}</span>
                  </span>
                  {item.attachments?.length > 0 && (
                    <span className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                      {item.attachments.slice(0, 2).map((attachment) => (
                        <span key={attachment.id} className="inline-flex max-w-52 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          {attachment.mime_type === 'application/pdf'
                            ? <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
                            : <Paperclip className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                          <span className="truncate">{attachment.file_name}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="flex items-center pl-2">
                  <time className="whitespace-nowrap text-[11px] font-semibold text-zinc-500">{formatInboxTime(item.received_at)}</time>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
