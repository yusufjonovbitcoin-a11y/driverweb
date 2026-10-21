import { usd, day } from "./format";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { displayDayKey } from "../../i18n/timeZone";
import { formatNumber } from "../../i18n/format";
import {
  EMPTY_FINANCE,
  documentState,
  financeSummary,
  remaining,
  aging,
  downloadCsv,
  driverReport,
} from "../../services/finance/model";
import {
  readFinance,
  financeError,
  paymentAction,
} from "../../services/finance/api";
import { useFinanceText } from "./copy";
import { Badge, Empty, Field, Modal } from "./common";
import DocumentForm from "./DocumentForm";
import DocumentDetail from "./DocumentDetail";
import PaySettings from "./PaySettings";
import "./finance.css";
const tabs = [
  "queue",
  "invoices",
  "settlements",
  "expenses",
  "balances",
  "payments",
  "reports",
  "settings",
];
export default function FinanceWorkspace({
  loads = [],
  drivers = [],
  canManageAccounting = false,
  onOpenLoad,
}) {
  const f = useFinanceText(),
    tabId = useId(),
    [tab, setTab] = useState("queue"),
    [data, setData] = useState(EMPTY_FINANCE),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [driver, setDriver] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState(new Set()),
    [create, setCreate] = useState(""),
    [opened, setOpened] = useState("");
  const [period, setPeriod] = useState({ from: "", to: "" }),
    [paymentEdit, setPaymentEdit] = useState(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const today = displayDayKey(new Date()),
    abort = useRef(null),
    connected = !error && !!data.today;
  const refresh = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const result = await readFinance(controller.signal);
      if (!controller.signal.aborted) {
        setData(result);
        setError("");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(financeError(err));
        setData(EMPTY_FINANCE);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [refresh]);
  const canWrite =
    canManageAccounting && connected && !loading && data.can_write === true;
  const fallbackLoads = loads
    .filter((load) => load.driverId)
    .map((load) => ({
      id: load.id,
      load_number: load.loadNumber,
      status: load.databaseStatus || "assigned",
      broker: load.broker,
      driver_id: load.driverId,
      gross: load.rateKnown === false ? null : load.rate,
      miles: load.distanceKnown === false ? null : load.distanceMiles,
      has_pod: !!load.documents?.receiverPod,
    }));
  const sourceLoads = connected ? data.loads : fallbackLoads;
  const visibleLoads = sourceLoads.filter(
    (load) =>
      (!driver || load.driver_id === driver) &&
      (!status || load.status === status) &&
      `${load.load_number} ${load.broker || ""} ${drivers.find((d) => d.id === load.driver_id)?.name || ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const kind = {
    invoices: "invoice",
    settlements: "settlement",
    expenses: "expense",
    balances: "advance",
  }[tab];
  const visibleDocs = data.documents.filter(
    (doc) =>
      (!kind || doc.kind === kind) &&
      (!driver || doc.driver_id === driver) &&
      (!status || documentState(doc, today) === status) &&
      (!period.from || doc.document_date >= period.from) &&
      (!period.to || doc.document_date <= period.to) &&
      `${doc.number} ${doc.counterparty}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const visiblePayments = data.payments.filter(
    (p) =>
      (!period.from || p.payment_date >= period.from) &&
      (!period.to || p.payment_date <= period.to) &&
      `${p.reference} ${data.documents.find((d) => d.id === p.document_id)?.counterparty}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const summary = financeSummary(data, today, period.from, period.to),
    doc = data.documents.find((d) => d.id === opened);
  const changeTab = (value) => {
    setTab(value);
    setStatus("");
    setSearch("");
    setPeriod({ from: "", to: "" });
  };
  const choose = (id, checked) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const afterCreate = async (id) => {
    setCreate("");
    setSelected(new Set());
    setOpened(id);
    await refresh();
  };
  async function mutatePayment(event) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await paymentAction(paymentEdit.id, paymentEdit.action, reason);
      setPaymentEdit(null);
      setReason("");
      await refresh();
    } catch (err) {
      setActionError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  function exportRows() {
    if (tab === "queue")
      downloadCsv("loads.csv", [
        [f("load"), f("broker"), f("gross"), f("miles"), f("status")],
        ...visibleLoads.map((l) => [
          l.load_number,
          l.broker,
          l.gross,
          l.miles,
          l.status,
        ]),
      ]);
    else if (tab === "payments")
      downloadCsv("payments.csv", [
        [f("date"), f("reference"), f("amount"), f("method"), f("status")],
        ...visiblePayments.map((p) => [
          p.payment_date,
          p.reference,
          p.amount,
          p.method,
          f(p.voided_at ? "void" : p.reconciled_at ? "matched" : "unmatched"),
        ]),
      ]);
    else if (tab === "reports")
      downloadCsv("trial-balance.csv", [
        [f("account"), f("debit"), f("credit")],
        ...summary.ledger.map((r) => [r.code, r.debit / 100, r.credit / 100]),
      ]);
    else
      downloadCsv(`${tab}.csv`, [
        [
          f("number"),
          f("counterparty"),
          f("date"),
          f("total"),
          f(tab === "balances" ? "recovered" : "paid"),
          f("credited"),
          f("remaining"),
          f("status"),
        ],
        ...visibleDocs.map((d) => [
          d.number,
          d.counterparty,
          d.document_date,
          d.total,
          d.kind === "advance" ? d.recovered : d.paid,
          d.credited,
          remaining(d) / 100,
          documentState(d, today),
        ]),
      ]);
  }
  return (
    <section className="fin-workspace">
      <header className="fin-topline">
        <div>
          <span className="fin-eyebrow">
            <Wallet size={15} />
            {f("workspace")}
          </span>
          <span className={`fin-connection ${connected ? "is-connected" : ""}`}>
            <i />
            {f(
              connected
                ? "connected"
                : error === "notInstalled"
                  ? "setupRequired"
                  : "readOnly",
            )}
          </span>
        </div>
        <div>
          <button
            className="fin-button fin-icon-button"
            aria-label={f("refresh")}
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw size={16} className={loading ? "fin-spin" : ""} />
          </button>
          <button
            className="fin-button"
            disabled={loading}
            onClick={exportRows}
          >
            <Download size={15} />
            {f("export")}
          </button>
        </div>
      </header>
      <nav
        role="tablist"
        aria-label={f("workspace")}
        className="fin-tabs"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const i = tabs.indexOf(tab);
          const next =
            e.key === "Home"
              ? tabs[0]
              : e.key === "End"
                ? tabs.at(-1)
                : tabs[
                    (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                      tabs.length
                  ];
          changeTab(next);
          e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
        }}
      >
        {tabs.map((value) => (
          <button
            key={value}
            id={`${tabId}-${value}`}
            data-tab={value}
            aria-controls={`${tabId}-panel`}
            type="button"
            role="tab"
            aria-selected={value === tab}
            tabIndex={value === tab ? 0 : -1}
            onClick={() => changeTab(value)}
          >
            {f(value)}
            {["invoices", "settlements"].includes(value) &&
              data.documents.some(
                (d) =>
                  d.kind === (value === "invoices" ? "invoice" : "settlement"),
              ) && (
                <span>
                  {
                    data.documents.filter(
                      (d) =>
                        d.kind ===
                          (value === "invoices" ? "invoice" : "settlement") &&
                        d.status !== "void",
                    ).length
                  }
                </span>
              )}
          </button>
        ))}
      </nav>
      {error && (
        <div role="alert" className="fin-connection-alert">
          <ShieldCheck size={18} />
          <p>
            {f(error === "notInstalled" ? "notInstalled" : "errors." + error)}
          </p>
          <button className="fin-button" disabled={loading} onClick={refresh}>
            {f("retry")}
          </button>
        </div>
      )}
      {connected &&
        data.loads.some(
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
        ) && (
          <div className="fin-connection-alert">
            <p>{f("legacy")}</p>
          </div>
        )}
      <section
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
      >
        {tab !== "settings" && (
          <div className="fin-metrics">
            {["receivable", "payable", "overdue", "profit"].map((key, i) => (
              <article key={key}>
                <span>
                  {i === 0 ? (
                    <ArrowDownLeft size={14} />
                  ) : i === 1 ? (
                    <ArrowUpRight size={14} />
                  ) : null}
                  {f(key)}
                </span>
                <strong data-negative={connected && summary[key] < 0}>
                  {connected ? usd(summary[key] / 100) : "—"}
                </strong>
                <small>{i < 3 ? "USD" : f("period")}</small>
              </article>
            ))}
          </div>
        )}
        <div className="fin-panel">
          <header className="fin-panel-header">
            <div>
              <h2>{f(tab)}</h2>
              {tab === "queue" && <p>{f("queueHint")}</p>}
            </div>
            <div className="fin-header-actions">
              {tab === "queue" && (
                <>
                  <button
                    className="fin-button"
                    disabled={!canWrite}
                    onClick={() => setCreate("settlement")}
                  >
                    {f("newSettlement")}
                  </button>
                  <button
                    className="fin-button fin-primary"
                    disabled={!canWrite}
                    onClick={() => setCreate("invoice")}
                  >
                    <Plus size={15} />
                    {f("newInvoice")}
                  </button>
                </>
              )}
              {["invoices", "settlements", "expenses", "balances"].includes(
                tab,
              ) && (
                <button
                  className="fin-button fin-primary"
                  disabled={!canWrite}
                  onClick={() => setCreate(kind)}
                >
                  <Plus size={15} />
                  {f(
                    {
                      invoice: "newInvoice",
                      settlement: "newSettlement",
                      expense: "newExpense",
                      advance: "newAdvance",
                    }[kind],
                  )}
                </button>
              )}
            </div>
          </header>
          {tab !== "settings" && (
            <div className="fin-toolbar">
              {tab !== "reports" && (
                <label className="fin-search">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label={f("search")}
                    placeholder={f("search")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              )}
              {!["reports", "payments"].includes(tab) && (
                <>
                  <select
                    aria-label={f("driver")}
                    value={driver}
                    onChange={(e) => setDriver(e.target.value)}
                  >
                    <option value="">{f("allDrivers")}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={f("status")}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">{f("allStatuses")}</option>
                    {(tab === "queue"
                      ? [
                          "assigned",
                          "in_progress",
                          "delivered",
                          "completed",
                          "cancelled",
                        ]
                      : ["draft", "open", "partial", "overdue", "paid", "void"]
                    ).map((value) => (
                      <option key={value} value={value}>
                        {f(
                          {
                            open: "openStatus",
                            paid: "paidStatus",
                            overdue: "overdueStatus",
                          }[value] || value,
                        )}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {tab !== "queue" && (
                <div className="fin-date-range">
                  <CalendarDays size={15} />
                  <input
                    type="date"
                    aria-label={f("from")}
                    value={period.from}
                    max={period.to || undefined}
                    onChange={(e) =>
                      setPeriod({ ...period, from: e.target.value })
                    }
                  />
                  <span>—</span>
                  <input
                    type="date"
                    aria-label={f("to")}
                    min={period.from || undefined}
                    value={period.to}
                    onChange={(e) =>
                      setPeriod({ ...period, to: e.target.value })
                    }
                  />
                </div>
              )}
            </div>
          )}
          {tab === "queue" &&
            (visibleLoads.length ? (
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label={f("selected")}
                          checked={
                            visibleLoads.length > 0 &&
                            visibleLoads.every((l) => selected.has(l.id))
                          }
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              visibleLoads.forEach((l) =>
                                e.target.checked
                                  ? next.add(l.id)
                                  : next.delete(l.id),
                              );
                              return next;
                            })
                          }
                        />
                      </th>
                      {[
                        "load",
                        "broker",
                        "driver",
                        "gross",
                        "miles",
                        "documents",
                        "status",
                      ].map((k) => (
                        <th
                          key={k}
                          className={
                            ["gross", "miles"].includes(k) ? "fin-number" : ""
                          }
                        >
                          {f(k)}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLoads.map((load) => (
                      <tr key={load.id} data-selected={selected.has(load.id)}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${f("load")} ${load.load_number}`}
                            checked={selected.has(load.id)}
                            onChange={(e) => choose(load.id, e.target.checked)}
                          />
                        </td>
                        <th scope="row">
                          <button
                            className="fin-link"
                            onClick={() => {
                              const real = loads.find((l) => l.id === load.id);
                              if (real) onOpenLoad(real);
                            }}
                          >
                            {String(load.load_number).startsWith("#")
                              ? load.load_number
                              : "#" + load.load_number}
                          </button>
                        </th>
                        <td>{load.broker || "—"}</td>
                        <td>
                          {drivers.find((d) => d.id === load.driver_id)?.name ||
                            "—"}
                        </td>
                        <td className="fin-number">
                          <strong>{usd(load.gross)}</strong>
                        </td>
                        <td className="fin-number">
                          {load.miles == null ? "—" : formatNumber(load.miles)}
                        </td>
                        <td>
                          <span
                            className={`fin-document-state ${load.has_pod ? "is-ready" : ""}`}
                          >
                            {load.has_pod ? "POD ✓" : f("missingPod")}
                          </span>
                        </td>
                        <td>
                          <Badge state={load.status} />
                        </td>
                        <td>
                          {load.invoice_id && (
                            <button
                              className="fin-link"
                              onClick={() => setOpened(load.invoice_id)}
                            >
                              {f("invoice")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={9}>
                        {f("selected")}: {selected.size}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <Empty />
            ))}
          {["invoices", "settlements", "expenses"].includes(tab) &&
            (visibleDocs.length ? (
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      {[
                        "number",
                        "counterparty",
                        "date",
                        "due",
                        "total",
                        "paid",
                        "remaining",
                        "status",
                      ].map((k) => (
                        <th
                          key={k}
                          className={
                            ["total", "paid", "remaining"].includes(k)
                              ? "fin-number"
                              : ""
                          }
                        >
                          {f(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocs.map((d) => (
                      <tr key={d.id}>
                        <th scope="row">
                          <button
                            className="fin-link"
                            onClick={() => setOpened(d.id)}
                          >
                            #{d.number}
                          </button>
                        </th>
                        <td>{d.counterparty}</td>
                        <td>{day(d.document_date)}</td>
                        <td>{day(d.due_date)}</td>
                        <td className="fin-number">{usd(d.total)}</td>
                        <td className="fin-number">{usd(d.paid)}</td>
                        <td className="fin-number">
                          <strong>{usd(remaining(d) / 100)}</strong>
                        </td>
                        <td>
                          <Badge state={documentState(d, today)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty />
            ))}
          {tab === "balances" &&
            (visibleDocs.length ? (
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      {[
                        "number",
                        "driver",
                        "date",
                        "issued",
                        "recovered",
                        "reserved",
                        "balance",
                        "status",
                      ].map((k) => (
                        <th key={k}>{f(k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocs.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <button
                            className="fin-link"
                            onClick={() => setOpened(d.id)}
                          >
                            #{d.number}
                          </button>
                        </td>
                        <td>{d.counterparty}</td>
                        <td>{day(d.document_date)}</td>
                        <td>{usd(d.total)}</td>
                        <td>{usd(d.recovered)}</td>
                        <td>{usd(Number(d.applied) - Number(d.recovered))}</td>
                        <td>
                          <strong>
                            {usd(Number(d.total) - Number(d.recovered))}
                          </strong>
                        </td>
                        <td>
                          <Badge state={documentState(d, today)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty />
            ))}
          {tab === "payments" &&
            (visiblePayments.length ? (
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      {[
                        "date",
                        "counterparty",
                        "reference",
                        "method",
                        "amount",
                        "status",
                        "actions",
                      ].map((k) => (
                        <th key={k}>{f(k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePayments.map((p) => (
                      <tr key={p.id}>
                        <td>{day(p.payment_date)}</td>
                        <td>
                          <button
                            className="fin-link"
                            onClick={() => setOpened(p.document_id)}
                          >
                            {
                              data.documents.find((d) => d.id === p.document_id)
                                ?.counterparty
                            }
                          </button>
                        </td>
                        <td>{p.reference}</td>
                        <td>{p.method.toUpperCase()}</td>
                        <td>{usd(p.amount)}</td>
                        <td>
                          {f(
                            p.voided_at
                              ? "void"
                              : p.reconciled_at
                                ? "matched"
                                : "unmatched",
                          )}
                        </td>
                        <td>
                          {canWrite && !p.voided_at && !p.reconciled_at && (
                            <>
                              <button
                                className="fin-link"
                                onClick={() => {
                                  setPaymentEdit({ ...p, action: "reconcile" });
                                  setActionError("");
                                }}
                              >
                                {f("markReconciled")}
                              </button>
                              <button
                                className="fin-link fin-danger"
                                onClick={() => {
                                  setPaymentEdit({ ...p, action: "void" });
                                  setActionError("");
                                }}
                              >
                                {f("voidAction")}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty />
            ))}
          {tab === "reports" && (
            <div className="fin-reports">
              <div className="fin-report-metrics">
                {["revenue", "expense", "profit", "cashMovement"].map((key) => (
                  <div key={key}>
                    <span>{f(key === "expense" ? "expenses" : key)}</span>
                    <strong>{connected ? usd(summary[key] / 100) : "—"}</strong>
                  </div>
                ))}
              </div>
              <div className="fin-aging">
                {["invoice", "expense", "settlement"].map((type) => (
                  <section key={type}>
                    <h3>
                      {f(type === "invoice" ? "arAging" : "apAging")} ·{" "}
                      {f(type)}
                    </h3>
                    {aging(data.documents, today, type).map((amount, i) => (
                      <div key={i}>
                        <span>
                          {f(
                            ["current", "days30", "days60", "days90", "days91"][
                              i
                            ],
                          )}
                        </span>
                        <strong>{connected ? usd(amount / 100) : "—"}</strong>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              <h3 className="fin-subtitle">{f("driverReport")}</h3>
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      {[
                        "driver",
                        "load",
                        "earnings",
                        "adjustments",
                        "total",
                        "paid",
                        "remaining",
                      ].map((key) => (
                        <th key={key}>{f(key)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {driverReport(data.documents, period.from, period.to).map(
                      (row) => (
                        <tr key={row.driverId}>
                          <td>{row.name}</td>
                          <td>{row.loads}</td>
                          <td>{usd(row.earnings / 100)}</td>
                          <td>{usd(row.adjustments / 100)}</td>
                          <td>{usd(row.total / 100)}</td>
                          <td>{usd(row.paid / 100)}</td>
                          <td>{usd((row.total - row.paid) / 100)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <h3 className="fin-subtitle">{f("trial")}</h3>
              <div className="fin-table-scroll">
                <table className="fin-table">
                  <thead>
                    <tr>
                      {["account", "debit", "credit", "ledgerBalance"].map(
                        (k) => (
                          <th key={k}>{f(k)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.ledger
                      .filter((row) => row.debit || row.credit)
                      .map((row) => (
                        <tr key={row.code}>
                          <td>
                            {row.code} · {f("accounts." + row.code)}
                          </td>
                          <td>{usd(row.debit / 100)}</td>
                          <td>{usd(row.credit / 100)}</td>
                          <td>{usd(row.balance / 100)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>{f("total")}</th>
                      <td>
                        {connected
                          ? usd(
                              summary.ledger.reduce((s, r) => s + r.debit, 0) /
                                100,
                            )
                          : "—"}
                      </td>
                      <td>
                        {connected
                          ? usd(
                              summary.ledger.reduce((s, r) => s + r.credit, 0) /
                                100,
                            )
                          : "—"}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <h3 className="fin-subtitle">{f("journal")}</h3>
              <div className="fin-journal">
                {data.journal
                  .filter(
                    (j) =>
                      (!period.from || j.entry_date >= period.from) &&
                      (!period.to || j.entry_date <= period.to),
                  )
                  .map((j) => (
                    <article key={j.id}>
                      <span>{day(j.entry_date)}</span>
                      <button
                        className="fin-link"
                        onClick={() => setOpened(j.document_id)}
                      >
                        {j.memo}
                      </button>
                      <strong>
                        {usd(
                          j.entries.reduce(
                            (s, line) => s + Number(line.debit),
                            0,
                          ),
                        )}
                      </strong>
                    </article>
                  ))}
              </div>
            </div>
          )}
          {tab === "settings" && (
            <PaySettings
              data={data}
              drivers={drivers}
              today={today}
              canWrite={canWrite}
              onChanged={refresh}
            />
          )}
        </div>
      </section>
      {create && (
        <DocumentForm
          kind={create}
          data={data}
          drivers={drivers}
          selected={selected}
          today={today}
          onClose={() => setCreate("")}
          onSaved={afterCreate}
        />
      )}
      {doc && (
        <DocumentDetail
          key={doc.id}
          doc={doc}
          payments={data.payments.filter((p) => p.document_id === doc.id)}
          credits={(data.credits || []).filter((c) => c.document_id === doc.id)}
          today={today}
          canWrite={canWrite}
          onClose={() => setOpened("")}
          onChanged={refresh}
        />
      )}
      {paymentEdit && (
        <Modal
          title={f(
            paymentEdit.action === "void" ? "voidAction" : "markReconciled",
          )}
          onClose={() => setPaymentEdit(null)}
          busy={busy}
        >
          <form onSubmit={mutatePayment}>
            <p className="fin-help">
              {paymentEdit.reference} · {usd(paymentEdit.amount)}
            </p>
            {paymentEdit.action === "void" && (
              <Field label={f("reason")}>
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            {actionError && (
              <p role="alert" className="fin-error">
                {f("errors." + actionError)}
              </p>
            )}
            <footer>
              <button className="fin-button fin-primary" disabled={busy}>
                {f(busy ? "saving" : "save")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
