import { useId, useRef } from "react";
import { X, FileText } from "lucide-react";
import useModalFocus from "../../hooks/useModalFocus";
import { useFinanceText } from "./copy";
export function Badge({ state }) {
  const f = useFinanceText();
  return (
    <span className="fin-badge" data-state={state}>
      {f(
        { open: "openStatus", paid: "paidStatus", overdue: "overdueStatus" }[
          state
        ] || state,
      )}
    </span>
  );
}
export function Empty() {
  const f = useFinanceText();
  return (
    <div className="fin-empty">
      <FileText size={28} />
      <p>{f("empty")}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}) {
  const ref = useRef(null),
    id = useId(),
    f = useFinanceText();
  useModalFocus(ref, { onClose, busy });
  return (
    <div className="fin-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={`fin-modal ${wide ? "fin-modal-wide" : ""}`}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            aria-label={f("close")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children, ...props }) {
  return (
    <label className="fin-field" {...props}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function MoneyInput(props) {
  return (
    <input
      type="number"
      min="0.01"
      max="999999999.99"
      step="0.01"
      inputMode="decimal"
      required
      {...props}
    />
  );
}
