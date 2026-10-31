import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Download, LoaderCircle, Send, X } from "lucide-react";
import useModalFocus from "../../hooks/useModalFocus";
import { useSettlementText } from "./text";
const PdfDocumentViewer = lazy(() => import("../PdfDocumentViewer"));
export default function Statement({ snapshot, onClose, onEscape, editor, toolbar, renderPageOverlay, onConfirm, confirmDisabled = false, confirmHint, confirming = false, confirmationError, stalePreview = false, canSendToDriver = false, deliveryApi, pdfLoader }) {
  const t = useSettlementText(),
    ref = useRef(null),
    id = useId();
  const viewerStateRef = useRef(null);
  const sendingRef = useRef(false);
  const [delivery, setDelivery] = useState(null);
  const deliveryState = delivery?.snapshot === snapshot ? delivery : null;
  const sending = deliveryState?.status === 'sending';
  const [attempt, setAttempt] = useState(0),
    [result, setResult] = useState(null);
  useModalFocus(ref, { onClose: onEscape || onClose, busy: sending || confirming });
  useEffect(() => {
    let active = true,
      url;
    const controller = new AbortController();
    async function prepare() {
      try {
        if (snapshot.storedPdf && !snapshot.isDemo) {
          const load = pdfLoader || (async entry => {
            const [{ requireSupabase }, { readSettlementPdf }] = await Promise.all([import('../../lib/supabase'), import('../../services/driverSettlements.js')]);
            return readSettlementPdf(requireSupabase(), entry);
          });
          const blob = await load(snapshot);
          if (!active) return;
          url = URL.createObjectURL(blob);
          setResult({ snapshot, attempt, url, fields: [], blob });
          return;
        }
        const [{ createSettlementPdf }, font] = await Promise.all([
          import("./pdf"),
          fetch(new URL("../../assets/fonts/DejaVuSans.ttf", import.meta.url), {
            signal: controller.signal,
          }),
        ]);
        if (!font.ok) throw Error("asset");
        let fields;
        const bytes = await createSettlementPdf(snapshot, {
          fontBytes: await font.arrayBuffer(),
          onFields: value => { fields = value; },
        });
        if (!active) return;
        const blob = new Blob([bytes], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setResult({ snapshot, attempt, url, fields, blob });
      } catch (error) {
        if (active && error.name !== "AbortError")
          setResult({ snapshot, attempt, error: true });
      }
    }
    void prepare();
    return () => {
      active = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [snapshot, attempt, pdfLoader]);
  const ready =
    result?.snapshot === snapshot && result?.attempt === attempt
      ? result
      : null;
  const filename = `settlement-${snapshot.driver.id || "driver"}-${snapshot.calculation.period.from}-${snapshot.calculation.period.to}.pdf`;
  const allowDelivery = canSendToDriver && !snapshot.isDemo && snapshot.approvalStatus === 'approved';
  const showDelivery = snapshot.approvalStatus === 'approved' && canSendToDriver;
  const recipientName = snapshot.recipientName || snapshot.driver.name;
  async function sendToDriver() {
    if (!allowDelivery || !ready?.blob || stalePreview || sendingRef.current || deliveryState?.status === 'sent') return;
    sendingRef.current = true;
    setDelivery({ snapshot, status: 'sending' });
    try {
      const send = deliveryApi || (async payload => {
        const [{ requireSupabase }, { deliverDriverEarnings }] = await Promise.all([import('../../lib/supabase'), import('../../services/driverEarningsDelivery.js')]);
        return deliverDriverEarnings(requireSupabase(), payload);
      });
      await send({ snapshot, blob: ready.blob, fileName: filename });
      setDelivery({ snapshot, status: 'sent' });
    } catch (error) {
      const key = ['42P01', 'PGRST202', 'PGRST205'].includes(error.code) ? 'deliverySchemaMissing' : error.code === '42501' || error.message === 'EARNINGS_PERMISSION_DENIED' ? 'deliveryForbidden' : 'deliveryFailed';
      setDelivery({ snapshot, status: 'error', error: t(key) });
    } finally { sendingRef.current = false; }
  }
  return createPortal(
    <div className="ds-backdrop">
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`ds-modal ds-reference-modal${editor ? ' ds-editable-modal' : ''}${renderPageOverlay ? ' ds-inline-modal' : ''}`}
      >
        <header className="ds-modal-bar">
          <h2 id={id}>{t("previewTitle")}</h2>
          <div>
            {showDelivery && <button type="button" className="ds-primary ds-send-driver" onClick={sendToDriver} disabled={!allowDelivery || !ready?.blob || stalePreview || sending || deliveryState?.status === 'sent'} title={`${t('sendToDriver')}: ${recipientName}`}>
              {sending ? <LoaderCircle size={16} className="animate-spin" /> : deliveryState?.status === 'sent' ? <CheckCircle2 size={16} /> : <Send size={16} />}{t(sending ? 'sendingToDriver' : deliveryState?.status === 'sent' ? 'sentToDriver' : 'sendToDriver')}
            </button>}
            {ready?.url && !stalePreview ? (
              <a
                className="ds-primary ds-download"
                href={ready.url}
                download={filename}
              >
                <Download size={16} />
                {t("download")}
              </a>
            ) : (
              <button disabled>{t(stalePreview ? renderPageOverlay ? 'download' : 'applyPdfChanges' : 'exporting')}</button>
            )}
            <button disabled={sending || confirming} onClick={onClose} aria-label={t("close")}>
              <X size={18} />
            </button>
          </div>
        </header>
        {showDelivery && <div className="ds-delivery-status" role={deliveryState?.status === 'error' ? 'alert' : 'status'}>{deliveryState?.error || `${t(deliveryState?.status === 'sent' ? 'deliverySentHint' : 'deliveryRecipient')}: ${recipientName}`}</div>}
        {toolbar}
        <div className={`ds-pdf-content${editor ? ' ds-pdf-content-editable' : ''}`}>
        {editor}
        <div className="ds-pdf-preview-pane">
        {ready?.error ? (
          <div role="alert" className="ds-error">
            {t("exportError")}
            <button onClick={() => setAttempt((n) => n + 1)}>
              {t("retry")}
            </button>
          </div>
        ) : ready?.url ? (
          <div className="ds-reference-viewer">
            <Suspense fallback={<p role="status">{t("loading")}</p>}>
              <PdfDocumentViewer url={ready.url} title={t("previewTitle")} viewStateRef={viewerStateRef} renderPageOverlay={renderPageOverlay ? page => renderPageOverlay(ready.fields.filter(field => field.page === page)) : undefined} />
            </Suspense>
          </div>
        ) : (
          <p role="status" className="ds-pdf-loading">
            {t("exporting")}
          </p>
        )}
        </div>
        </div>
        {onConfirm && <footer className="ds-pdf-confirm-bar"><span role={confirmationError ? 'alert' : undefined}>{confirmationError || confirmHint}</span><button type="button" className="ds-primary" disabled={confirming || confirmDisabled || !ready?.url} onClick={() => { if (!confirming && !confirmDisabled && ready?.url) onConfirm({ blob: ready.blob, fileName: filename }); }}>{confirming ? <LoaderCircle size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{t(confirming ? 'saving' : 'approveCalculation')}</button></footer>}
      </section>
    </div>,
    document.body,
  );
}
