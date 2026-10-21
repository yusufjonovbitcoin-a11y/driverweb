import { usd } from "./format";
import { useRef, useState } from "react";
import { timeZonePreference } from "../../i18n/timeZone";
import { Plus, Trash2 } from "lucide-react";
import { createDocument, financeError } from "../../services/finance/api";
import { eligibleLoad, EXPENSE_CODES } from "../../services/finance/model";
import { Modal, Field, MoneyInput } from "./common";
import { useFinanceText } from "./copy";
export default function DocumentForm({
  kind,
  data,
  drivers,
  selected,
  today,
  onClose,
  onSaved,
}) {
  const f = useFinanceText(),
    operation = useRef(crypto.randomUUID());
  const initial = data.loads.filter((load) => selected.has(load.id));
  const [party, setParty] = useState(
    kind === "invoice" ? initial[0]?.broker || "" : "",
  );
  const [driver, setDriver] = useState(
    kind === "settlement" ? initial[0]?.driver_id || "" : "",
  );
  const [dates, setDates] = useState({
    document_date: today,
    due_date: today,
    period_from: today.slice(0, 8) + "01",
    period_to: today,
  });
  const [ids, setIds] = useState(() => new Set(initial.map((load) => load.id)));
  const [items, setItems] = useState(
    ["expense", "advance"].includes(kind)
      ? [
          {
            id: crypto.randomUUID(),
            description: "",
            amount: "",
            type: "addition",
            account: "5600",
            calculation: "fixed",
          },
        ]
      : [],
  );
  const [advances, setAdvances] = useState({}),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const options = data.loads.filter((load) =>
    eligibleLoad(load, kind, driver, party),
  );
  const chosen = options.filter((load) => ids.has(load.id));
  const updateItem = (id, key, value) =>
    setItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const dirty =
    items.some((item) => item.description || item.amount) ||
    notes ||
    ids.size > 0;
  const close = () => {
    if (!dirty || window.confirm(f("unsaved"))) onClose();
  };
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const counterparty = ["settlement", "advance"].includes(kind)
        ? drivers.find((d) => d.id === driver)?.name
        : party;
      const id = await createDocument(operation.current, kind, {
        ...dates,
        time_zone: timeZonePreference.getSnapshot(),
        driver_id: driver || null,
        counterparty,
        load_ids: chosen.map((load) => load.id),
        items: items.map((item) => ({
          description: item.description,
          amount: item.amount,
          type: item.type,
          account: item.account,
          calculation: item.calculation,
        })),
        notes,
        advances: Object.entries(advances)
          .filter(([, amount]) => Number(amount) > 0)
          .map(([id, amount]) => ({ id, amount })),
      });
      await onSaved(id);
    } catch (err) {
      setError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={f(kind)} onClose={close} busy={busy} wide>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="fin-form-grid">
            {["settlement", "advance"].includes(kind) ? (
              <Field label={f("driver")}>
                <select
                  required
                  value={driver}
                  onChange={(e) => {
                    setDriver(e.target.value);
                    setIds(new Set());
                    setAdvances({});
                  }}
                >
                  <option value="">—</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={f("counterparty")}>
                {kind === "invoice" ? (
                  <select
                    required
                    value={party}
                    onChange={(e) => {
                      setParty(e.target.value);
                      setIds(new Set());
                    }}
                  >
                    <option value="">—</option>
                    {[
                      ...new Set(
                        data.loads
                          .filter(
                            (l) =>
                              ["delivered", "completed"].includes(l.status) &&
                              l.broker,
                          )
                          .map((l) => l.broker),
                      ),
                    ].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    maxLength={200}
                    value={party}
                    onChange={(e) => setParty(e.target.value)}
                  />
                )}
              </Field>
            )}
            {[
              "document_date",
              "due_date",
              ...(kind === "settlement" ? ["period_from", "period_to"] : []),
            ].map((key) => (
              <Field
                key={key}
                label={f(
                  {
                    document_date: "date",
                    due_date: "due",
                    period_from: "from",
                    period_to: "to",
                  }[key],
                )}
              >
                <input
                  type="date"
                  required
                  value={dates[key]}
                  min={
                    key === "due_date"
                      ? dates.document_date
                      : key === "period_to"
                        ? dates.period_from
                        : undefined
                  }
                  onChange={(e) =>
                    setDates({ ...dates, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          {["invoice", "settlement"].includes(kind) && (
            <div className="fin-source-list">
              <h3>
                {f("load")} · {chosen.length}
              </h3>
              {options.length ? (
                options.map((load) => (
                  <label key={load.id}>
                    <input
                      type="checkbox"
                      checked={ids.has(load.id)}
                      onChange={(e) =>
                        setIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(load.id);
                          else next.delete(load.id);
                          return next;
                        })
                      }
                    />
                    <strong>
                      #{String(load.load_number).replace(/^#/, "")}
                    </strong>
                    <span>{load.broker}</span>
                    <b>{usd(load.gross)}</b>
                  </label>
                ))
              ) : (
                <p>{f("empty")}</p>
              )}
            </div>
          )}
          {chosen.some(
            (load) =>
              load.legacy_accounting &&
              [
                "driver_pay",
                "broker_paid",
                "additional_income",
                "fuel_cost",
                "toll_cost",
                "other_cost",
              ].some((key) => load.legacy_accounting[key] != null),
          ) && <p className="fin-warning">{f("legacy")}</p>}
          <div className="fin-lines">
            <h3>{f(kind === "settlement" ? "addition" : "description")}</h3>
            {items.map((item) => (
              <div className="fin-line" key={item.id}>
                {kind === "settlement" && (
                  <select
                    aria-label={f("method")}
                    value={item.type}
                    onChange={(e) =>
                      updateItem(item.id, "type", e.target.value)
                    }
                  >
                    {["addition", "deduction", "reimbursement"].map((type) => (
                      <option key={type} value={type}>
                        {f(type)}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  aria-label={f("description")}
                  placeholder={f("description")}
                  required
                  maxLength={200}
                  value={item.description}
                  onChange={(e) =>
                    updateItem(item.id, "description", e.target.value)
                  }
                />
                {kind === "expense" && (
                  <select
                    aria-label={f("account")}
                    value={item.account}
                    onChange={(e) =>
                      updateItem(item.id, "account", e.target.value)
                    }
                  >
                    {EXPENSE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {f("accounts." + code)}
                      </option>
                    ))}
                  </select>
                )}
                {["invoice", "settlement"].includes(kind) && (
                  <select
                    aria-label={f("calculation")}
                    value={item.calculation}
                    onChange={(e) =>
                      updateItem(item.id, "calculation", e.target.value)
                    }
                  >
                    <option value="fixed">USD</option>
                    <option value="percentage">% Gross</option>
                  </select>
                )}
                <MoneyInput
                  max={item.calculation === "percentage" ? 100 : 999999999.99}
                  aria-label={f("amount")}
                  placeholder="USD"
                  value={item.amount}
                  onChange={(e) =>
                    updateItem(item.id, "amount", e.target.value)
                  }
                />
                <button
                  type="button"
                  aria-label={f("remove")}
                  onClick={() =>
                    setItems(items.filter((row) => row.id !== item.id))
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="fin-button"
              onClick={() =>
                setItems([
                  ...items,
                  {
                    id: crypto.randomUUID(),
                    description: "",
                    amount: "",
                    type: "addition",
                    account: "5600",
                    calculation: "fixed",
                  },
                ])
              }
            >
              <Plus size={15} />
              {f("addLine")}
            </button>
          </div>
          {kind === "settlement" &&
            data.documents
              .filter(
                (d) =>
                  d.kind === "advance" &&
                  d.status === "posted" &&
                  d.driver_id === driver &&
                  Number(d.total) > Number(d.applied),
              )
              .map((adv) => (
                <Field
                  key={adv.id}
                  label={`${f("applyAdvance")} #${adv.number} · ${usd(Number(adv.total) - Number(adv.applied))}`}
                >
                  <input
                    type="number"
                    min="0"
                    max={Number(adv.total) - Number(adv.applied)}
                    step="0.01"
                    value={advances[adv.id] || ""}
                    onChange={(e) =>
                      setAdvances({ ...advances, [adv.id]: e.target.value })
                    }
                  />
                </Field>
              ))}
          <Field label={f("notes")}>
            <textarea
              maxLength={2000}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <p className="fin-help">
            {f(kind === "advance" ? "advanceHint" : "createHint")}
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="fin-error">
            {f("errors." + error)}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="fin-button"
            disabled={busy}
            onClick={close}
          >
            {f("cancel")}
          </button>
          <button
            className="fin-button fin-primary"
            type="submit"
            disabled={
              busy ||
              (["invoice", "settlement"].includes(kind) && !chosen.length) ||
              (["expense", "advance"].includes(kind) && !items.length)
            }
          >
            {f(busy ? "saving" : "save")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
