import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import useModalFocus from "../../hooks/useModalFocus";
import { useSettlementText } from "./text";
const PdfDocumentViewer = lazy(() => import("../PdfDocumentViewer"));
export default function Statement({ snapshot, onClose }) {
  const t = useSettlementText(),
    ref = useRef(null),
    id = useId();
  const [attempt, setAttempt] = useState(0),
    [result, setResult] = useState(null);
  useModalFocus(ref, { onClose });
  useEffect(() => {
    let active = true,
      url;
    const controller = new AbortController();
    async function prepare() {
      try {
        const [{ createSettlementPdf }, font] = await Promise.all([
          import("./pdf"),
          fetch(new URL("../../assets/fonts/DejaVuSans.ttf", import.meta.url), {
            signal: controller.signal,
          }),
        ]);
        if (!font.ok) throw Error("asset");
        const bytes = await createSettlementPdf(snapshot, {
          fontBytes: await font.arrayBuffer(),
        });
        if (!active) return;
        url = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
        setResult({ snapshot, attempt, url });
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
  }, [snapshot, attempt]);
  const ready =
    result?.snapshot === snapshot && result?.attempt === attempt
      ? result
      : null;
  const filename = `settlement-${snapshot.driver.id || "driver"}-${snapshot.calculation.period.from}-${snapshot.calculation.period.to}.pdf`;
  return createPortal(
    <div className="ds-backdrop">
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="ds-modal ds-reference-modal"
      >
        <header className="ds-modal-bar">
          <h2 id={id}>{t("previewTitle")}</h2>
          <div>
            {ready?.url ? (
              <a
                className="ds-primary ds-download"
                href={ready.url}
                download={filename}
              >
                <Download size={16} />
                {t("download")}
              </a>
            ) : (
              <button disabled>{t("exporting")}</button>
            )}
            <button onClick={onClose} aria-label={t("close")}>
              <X size={18} />
            </button>
          </div>
        </header>
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
              <PdfDocumentViewer url={ready.url} title={t("previewTitle")} />
            </Suspense>
          </div>
        ) : (
          <p role="status" className="ds-pdf-loading">
            {t("exporting")}
          </p>
        )}
      </section>
    </div>,
    document.body,
  );
}
