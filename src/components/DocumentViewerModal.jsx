import React, { useState } from 'react';
import { 
  X, 
  FileText, 
  Printer, 
  ZoomIn, 
  ShieldCheck,
  TriangleAlert,
  LoaderCircle,
} from 'lucide-react';

export default function DocumentViewerModal({ 
  isOpen, 
  onClose, 
  load, 
  onApproveAndInvoice 
}) {
  const [activeDocTab, setActiveDocTab] = useState('rateCon');
  const [approvedLoadId, setApprovedLoadId] = useState(null);

  if (!isOpen || !load) return null;
  const isApproved = approvedLoadId === load.id || load.status === 'COMPLETED';

  const docs = [
    {
      id: 'rateCon',
      title: 'Broker Rate Con',
      available: !!load.documents?.rateCon,
      url: load.documents?.rateCon,
      mimeType: load.documentMeta?.rateCon?.mimeType,
      review: load.documentChecks?.rateCon,
      type: 'Shartnoma & Stavka'
    },
    {
      id: 'shipperBol',
      title: 'Shipper BOL',
      available: !!load.documents?.shipperBol,
      url: load.documents?.shipperBol,
      mimeType: load.documentMeta?.shipperBol?.mimeType,
      review: load.documentChecks?.shipperBol,
      type: 'Bill of Lading'
    },
    {
      id: 'receiverPod',
      title: 'Receiver POD',
      available: !!load.documents?.receiverPod,
      url: load.documents?.receiverPod,
      mimeType: load.documentMeta?.receiverPod?.mimeType,
      review: load.documentChecks?.receiverPod,
      type: 'Proof of Delivery'
    }
  ];

  const currentDoc = docs.find(d => d.id === activeDocTab) || docs[0];

  const handleInvoiceClick = () => {
    setApprovedLoadId(load.id);
    onApproveAndInvoice(load.id);
  };

  const handleClose = () => {
    setActiveDocTab('rateCon');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden my-6 transition-colors">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">Hujjatlar Tekshiruvi & Faktura</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs font-semibold">
                {load.loadNumber}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {load.origin.city}, {load.origin.state} ➔ {load.destination.city}, {load.destination.state} • ${load.rate}
            </p>
          </div>

          <button
            onClick={handleClose}
            className="p-2 rounded-md text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 px-6 flex space-x-3 pt-2">
          {docs.map((doc) => {
            const isActive = activeDocTab === doc.id;
            return (
              <button
                key={doc.id}
                onClick={() => setActiveDocTab(doc.id)}
                className={`flex items-center space-x-2 px-3.5 py-2.5 border-b-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-zinc-900 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                }`}
              >
                <span>{doc.title}</span>
                {doc.available && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Document Preview Canvas */}
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-zinc-100/70 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl min-h-[440px] flex items-center justify-center p-3 relative">
              {currentDoc.available && currentDoc.url ? (
                <div className="relative group h-full w-full max-w-full flex items-center justify-center">
                  {currentDoc.mimeType === 'application/pdf' ? (
                    <iframe
                      src={currentDoc.url}
                      title={currentDoc.title}
                      className="h-[420px] w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
                    />
                  ) : (
                    <img
                      src={currentDoc.url}
                      alt={currentDoc.title}
                      className="max-h-[420px] w-auto object-contain rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-md"
                    />
                  )}
                  <a
                    href={currentDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute bottom-3 right-3 bg-white/95 dark:bg-zinc-900/95 border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shadow-xs"
                  >
                    <ZoomIn className="w-4 h-4" />
                    <span>Kattalashtirish</span>
                  </a>
                </div>
              ) : (
                <div className="text-center p-8 space-y-2.5 text-zinc-400 dark:text-zinc-500">
                  <FileText className="w-10 h-10 mx-auto text-zinc-400 dark:text-zinc-600" />
                  <div className="text-sm text-zinc-700 dark:text-zinc-300 font-semibold">Hujjat yuklanmagan</div>
                  <p className="text-xs max-w-xs text-zinc-500">
                    Haydovchi yukni olish yoki topshirish paytida mobil ilova orqali yuklaganda bu yerda paydo bo'ladi.
                  </p>
                </div>
              )}
            </div>

            {currentDoc.available && ['queued', 'checking'].includes(currentDoc.review?.check_status) && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-xs font-semibold text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                AI hujjatni tekshirmoqda
              </div>
            )}
            {currentDoc.available && ['warning', 'failed_to_read'].includes(currentDoc.review?.check_status) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex items-center gap-2 font-bold">
                  <TriangleAlert className="h-4 w-4" /> AI ogohlantirishi
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {(currentDoc.review.active_warnings || []).map((warning) => (
                    <li key={warning.id || warning.code}>{warning.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {currentDoc.available && currentDoc.review?.check_status === 'passed' && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4" /> AI tekshiruvidan o‘tdi
              </div>
            )}

            <div className="flex items-center justify-between text-zinc-500 text-xs pt-1">
              <span className="flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span>Raqamli audit va vaqt tamg'asi tasdiqlangan</span>
              </span>
              <button 
                onClick={() => window.print()}
                className="hover:text-zinc-800 dark:hover:text-zinc-300 flex items-center space-x-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Chop etish</span>
              </button>
            </div>
          </div>

          {/* Metadata & Billing Action */}
          <div className="space-y-4">
            
            {/* Specs Table */}
            <div className="bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide block pb-1 border-b border-zinc-200 dark:border-zinc-800">
                Yuk parametrlari
              </span>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Broker:</span>
                  <span className="text-zinc-800 dark:text-zinc-200 font-medium">{load.broker}</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-zinc-500 font-sans">Aloqa:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{load.brokerPhone}</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-zinc-500 font-sans">Stavka:</span>
                  <span className="text-zinc-900 dark:text-zinc-100 font-bold">${load.rate}</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-zinc-500 font-sans">RPM:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">${load.ratePerMile}/mi</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-zinc-500 font-sans">Vazni:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{load.weightLbs?.toLocaleString()} lbs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Texnika:</span>
                  <span className="text-zinc-700 dark:text-zinc-300 font-medium">{load.equipment}</span>
                </div>
              </div>
            </div>

            {/* Checklist */}
            <div className="bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300 block">Hujjatlar tekshiruvi:</span>
              
              <div className="space-y-2 text-xs">
                <div className="flex items-center space-x-2.5">
                  <span className={`w-2 h-2 rounded-full ${load.documents?.rateCon ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
                  <span className={load.documents?.rateCon ? 'text-zinc-800 dark:text-zinc-200 font-medium' : 'text-zinc-400 dark:text-zinc-500'}>
                    Rate Confirmation (Shartnoma)
                  </span>
                </div>

                <div className="flex items-center space-x-2.5">
                  <span className={`w-2 h-2 rounded-full ${load.documents?.shipperBol ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
                  <span className={load.documents?.shipperBol ? 'text-zinc-800 dark:text-zinc-200 font-medium' : 'text-zinc-400 dark:text-zinc-500'}>
                    Shipper Bill of Lading (BOL)
                  </span>
                </div>

                <div className="flex items-center space-x-2.5">
                  <span className={`w-2 h-2 rounded-full ${load.documents?.receiverPod ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
                  <span className={load.documents?.receiverPod ? 'text-zinc-800 dark:text-zinc-200 font-medium' : 'text-zinc-400 dark:text-zinc-500'}>
                    Receiver Proof of Delivery (POD)
                  </span>
                </div>
              </div>
            </div>

            {/* Billing Action */}
            <div className="pt-2">
              <button
                onClick={handleInvoiceClick}
                disabled={isApproved}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors shadow-xs ${
                  isApproved
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 cursor-default'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950'
                }`}
              >
                {isApproved ? '✓ Hisob-faktura yuborilgan' : 'Tasdiqlash va Invoys chiqarish'}
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
