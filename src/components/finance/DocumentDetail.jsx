import { usd, day } from "./format";
import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import {
  documentAction,
  recordPayment,
  creditInvoice,
  voidCredit,
  financeError,
} from "../../services/finance/api";
import {
  documentState,
  remaining,
  EXPENSE_CODES,
} from "../../services/finance/model";
import { Modal, Badge, Field, MoneyInput } from "./common";
import { useFinanceText } from "./copy";
export default function DocumentDetail({
  doc,
  payments,
  credits = [],
  today,
  canWrite,
  onClose,
  onChanged,
}) {
  const f = useFinanceText(),
    [action, setAction] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [credit, setCredit] = useState({ amount: "", reason: "", account: "4000" });
  const [payment, setPayment] = useState({
    amount: "",
    date: today,
    method: "bank",
    reference: "",
  });
  const operation = useRef(crypto.randomUUID());
  async function execute(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (action === "credit")
        await creditInvoice(operation.current, doc, credit);
      else if (action.startsWith("voidCredit:"))
        await voidCredit(action.split(":")[1], reason);
      else if (action === "payment")
        await recordPayment(operation.current, doc, payment);
      else await documentAction(doc, action, reason);
      setAction("");
      setReason("");
      operation.current = crypto.randomUUID();
      await onChanged();
    } catch (err) {
      setError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${f(doc.kind)} · #${doc.number}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="fin-document-print">
        <div className="fin-document-heading">
          <div>
            <h3>{doc.counterparty}</h3>
            <p>
              {day(doc.document_date)} → {day(doc.due_date)}
            </p>
            {doc.period_from && (
              <p>
                {day(doc.period_from)} — {day(doc.period_to)}
              </p>
            )}
          </div>
          <Badge state={documentState(doc, today)} />
        </div>
        <div className="fin-table-scroll">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{f("description")}</th>
                <th>{f("account")}</th>
                <th className="fin-number">{f("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <strong>{line.description}</strong>
                    {line.basis && (
                      <small>
                        {f(
                          {
                            contract: "gross",
                            assignment_snapshot: "snapshot",
                            percentage: "percentage",
                            mileage: "mileage",
                            flat: "flat",
                          }[line.basis] || line.basis,
                        )}{" "}
                        {line.miles != null ? ` · ${line.miles} mi` : ""}
                      </small>
                    )}
                    {line.tariff_source === "current_profile_at_statement" && (
                      <small>{f("legacyTariff")}</small>
                    )}
                    {line.calculation === "percentage" && (
                      <small>
                        {line.input_rate}% × {usd(line.base)}
                      </small>
                    )}
                    {line.due_on && <small>{day(line.due_on)}</small>}
                  </td>
                  <td>{f("accounts." + line.account)}</td>
                  <td className="fin-number">{usd(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>{f("total")}</th>
                <td className="fin-number">{usd(doc.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="fin-detail-totals">
          {Number(doc.credited) > 0 && (
            <div>
              <span>{f("credited")}</span>
              <strong>{usd(doc.credited)}</strong>
            </div>
          )}
          {doc.kind === "advance" && (
            <div>
              <span>{f("reserved")}</span>
              <strong>
                {usd(Number(doc.applied) - Number(doc.recovered))}
              </strong>
            </div>
          )}
          <div>
            <span>{f(doc.kind === "advance" ? "recovered" : "paid")}</span>
            <strong>
              {usd(doc.kind === "advance" ? doc.recovered : doc.paid)}
            </strong>
          </div>
          <div>
            <span>{f("remaining")}</span>
            <strong>{usd(remaining(doc) / 100)}</strong>
          </div>
        </div>
        {doc.notes && <p className="fin-document-notes">{doc.notes}</p>}
        <h3 className="fin-subtitle">{f("paymentHistory")}</h3>
        {payments.length ? (
          <div className="fin-table-scroll">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>{f("date")}</th>
                  <th>{f("reference")}</th>
                  <th>{f("method")}</th>
                  <th>{f("status")}</th>
                  <th className="fin-number">{f("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{day(p.payment_date)}</td>
                    <td>{p.reference}</td>
                    <td>{p.method}</td>
                    <td>
                      {p.voided_at
                        ? f("void")
                        : p.reconciled_at
                          ? f("matched")
                          : f("unmatched")}
                    </td>
                    <td className="fin-number">{usd(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fin-help">{f("empty")}</p>
        )}
        {credits.length > 0 && (
          <div className="fin-journal">
            {credits.map((c) => (
              <article key={c.id}>
                <span>{f(c.voided_at ? "void" : "credited")}</span>
                <span>{c.reason}</span>
                <strong>{usd(c.amount)}</strong>
                {canWrite && !c.voided_at && (
                  <button
                    className="fin-link"
                    onClick={() => setAction("voidCredit:" + c.id)}
                  >
                    {f("voidAction")}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        {doc.void_reason && <p className="fin-warning">{doc.void_reason}</p>}
      </div>
      <div className="fin-detail-actions">
        <button
          className="fin-button"
          type="button"
          onClick={() => window.print()}
        >
          <Printer size={15} />
          {f("print")}
        </button>
        {canWrite && doc.status !== "void" && (
          <>
            {doc.status === "draft" && (
              <button
                className="fin-button fin-primary"
                type="button"
                onClick={() => setAction("post")}
              >
                {f("post")}
              </button>
            )}
            {doc.status === "posted" &&
              doc.kind !== "advance" &&
              remaining(doc) > 0 && (
                <button
                  className="fin-button fin-primary"
                  type="button"
                  onClick={() => setAction("payment")}
                >
                  {f("payment")}
                </button>
              )}
            {doc.kind === "invoice" &&
              doc.status === "posted" &&
              remaining(doc) > 0 && (
                <button
                  className="fin-button"
                  type="button"
                  onClick={() => setAction("credit")}
                >
                  {f("creditAdjustment")}
                </button>
              )}
            <button
              className="fin-button fin-danger"
              type="button"
              onClick={() => setAction("void")}
            >
              {f("voidAction")}
            </button>
          </>
        )}
      </div>
      {action && (
        <form className="fin-action-form" onSubmit={execute}>
          <h3>
            {f(
              action === "payment"
                ? "payment"
                : action === "credit"
                  ? "creditAdjustment"
                  : action === "void" || action.startsWith("voidCredit:")
                    ? "voidAction"
                    : "post",
            )}
          </h3>
          <p className="fin-help">
            {f(
              action === "payment"
                ? "paymentHint"
                : action === "credit"
                  ? "creditHint"
                  : doc.kind === "advance"
                    ? "advanceHint"
                    : "postHint",
            )}
          </p>
          <fieldset disabled={busy}>
            {action === "credit" ? (
              <div className="fin-form-grid">
                <Field label={f("amount")}>
                  <MoneyInput
                    max={remaining(doc) / 100}
                    value={credit.amount}
                    onChange={(e) =>
                      setCredit({ ...credit, amount: e.target.value })
                    }
                  />
                </Field>
                <Field label={f("account")}>
                  <select
                    value={credit.account}
                    onChange={(e) =>
                      setCredit({ ...credit, account: e.target.value })
                    }
                  >
                    {["4000", ...EXPENSE_CODES].map((code) => (
                      <option key={code} value={code}>
                        {f("accounts." + code)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={f("reason")}>
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={credit.reason}
                    onChange={(e) =>
                      setCredit({ ...credit, reason: e.target.value })
                    }
                  />
                </Field>
              </div>
            ) : action === "payment" ? (
              <div className="fin-form-grid">
                <Field label={f("amount")}>
                  <MoneyInput
                    max={remaining(doc) / 100}
                    value={payment.amount}
                    onChange={(e) =>
                      setPayment({ ...payment, amount: e.target.value })
                    }
                  />
                </Field>
                <Field label={f("date")}>
                  <input
                    type="date"
                    required
                    min={doc.document_date}
                    value={payment.date}
                    onChange={(e) =>
                      setPayment({ ...payment, date: e.target.value })
                    }
                  />
                </Field>
                <Field label={f("method")}>
                  <select
                    value={payment.method}
                    onChange={(e) =>
                      setPayment({ ...payment, method: e.target.value })
                    }
                  >
                    {[
                      "bank",
                      "ach",
                      "check",
                      "zelle",
                      "cash",
                      "factoring",
                      "other",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {value.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={f("reference")}>
                  <input
                    required
                    maxLength={200}
                    value={payment.reference}
                    onChange={(e) =>
                      setPayment({ ...payment, reference: e.target.value })
                    }
                  />
                </Field>
              </div>
            ) : action === "void" || action.startsWith("voidCredit:") ? (
              <Field label={f("reason")}>
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            ) : null}
          </fieldset>
          {error && (
            <p className="fin-error" role="alert">
              {f("errors." + error)}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="fin-button"
              disabled={busy}
              onClick={() => setAction("")}
            >
              {f("cancel")}
            </button>
            <button
              type="submit"
              className="fin-button fin-primary"
              disabled={busy}
            >
              {f(busy ? "saving" : "save")}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
