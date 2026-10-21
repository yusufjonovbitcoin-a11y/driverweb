import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { displayDayKey } from "../../i18n/timeZone";
import { usd, day } from "../finance/format";
import { loadRateCents, accountingMiles } from "../accountingModel";
import {
  calculateSettlement,
  effectiveSettings,
  periodFor,
} from "./calculation";
import {
  readCalculationSettings,
  readDeliveryDates,
  writeCalculationSettings,
  settingsError,
} from "./api";
import SettingsPanel from "./SettingsPanel";
import Statement from "./Statement";
import AccountingDateFilter from "../AccountingDateFilter";
import { place } from "./calculation";
import { eligibleSettlementLoad, hasSavedSettings } from "./eligibility";
import { useSettlementText } from "./text";
import "./settlements.css";
const LIVE_API = {
  readCalculationSettings,
  readDeliveryDates,
  writeCalculationSettings,
};
const EMPTY = {
  version: 0,
  settlement_defaults: {},
  broker_commission_percent: null,
};
export default function SettlementWorkspace({
  loads = [],
  drivers = [],
  canManageAccounting = false,
  onOpenLoad,
  settingsApi = LIVE_API,
  initialView,
  company,
}) {
  const t = useSettlementText(),
    tabsId = useId(),
    abort = useRef(null),
    savingRef = useRef(false),
    dirtyRef = useRef(false);
  const [tab, setTab] = useState(initialView?.tab || "settings"),
    [scope, setScope] = useState(""),
    [record, setRecord] = useState(EMPTY),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [datesError, setDatesError] = useState(""),
    [notice, setNotice] = useState("");
  const [driver, setDriver] = useState(initialView?.driver || ""),
    [mode, setMode] = useState("manual"),
    [period, setPeriod] = useState(
      () => initialView?.period || periodFor("week", displayDayKey(new Date())),
    ),
    [selected, setSelected] = useState(
      () => new Set(initialView?.selected || []),
    ),
    [dates, setDates] = useState({}),
    [snapshot, setSnapshot] = useState(null);
  const dirty = useCallback((value) => {
    dirtyRef.current = value;
  }, []);
  const onSaving = useCallback((value) => {
    savingRef.current = value;
    setSaving(value);
  }, []);
  const refresh = useCallback(async () => {
    if (savingRef.current) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    setDatesError("");
    try {
      const [settings, delivery] = await Promise.allSettled([
        settingsApi.readCalculationSettings(controller.signal),
        settingsApi.readDeliveryDates(controller.signal),
      ]);
      if (!controller.signal.aborted) {
        if (settings.status === "fulfilled") setRecord(settings.value);
        else { setRecord(EMPTY); setError(settingsError(settings.reason)); }
        if (delivery.status === "fulfilled") setDates(delivery.value);
        else { setDates({}); setDatesError(settingsError(delivery.reason)); }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(settingsError(err));
        setRecord(EMPTY);
        setDates({});
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [settingsApi]);
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
  function discard() {
    if (savingRef.current) return false;
    return !dirtyRef.current || window.confirm(t("confirmDiscard"));
  }
  const visible = loads
    .filter(
      (l) =>
        drivers.some((d) => d.id === driver) && eligibleSettlementLoad(l, driver),
    )
    .map((l) => ({ ...l, deliveredAt: dates[l.id] || l.deliveredAt || null }))
    .filter((l) => {
      if (mode === "manual") return true;
      const d = l.deliveredAt && displayDayKey(new Date(l.deliveredAt));
      return d && d >= period.from && d <= period.to;
    });
  const chosen = visible.filter((l) => selected.has(l.id));
  let calculation = null,
    calculationError = "";
  const savedSettings = hasSavedSettings(record, driver);
  if (chosen.length && savedSettings && !error && !loading && !datesError) {
    try {
      calculation = calculateSettlement(
        chosen,
        effectiveSettings(record, driver),
        period,
      );
    } catch (err) {
      calculationError = err.message;
    }
  }
  const canWrite = canManageAccounting && !error && !loading;
  function preview() {
    if (!calculation || !drivers.some((d) => d.id === driver) ||
      calculation.rows.some((row) => !eligibleSettlementLoad(row.load, driver))) return;
    setSnapshot(
      structuredClone({
        calculation,
        driver: drivers.find((d) => d.id === driver) || { name: driver },
        version: record.version,
        company,
      }),
    );
  }
  return (
    <section className="ds-workspace">
      <nav className="ds-tabs" role="tablist" aria-label={t("settlements")}>
        {["settlements", "settings"].map((key, i) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${tabsId}-${key}-tab`}
            aria-controls={`${tabsId}-${key}-panel`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            disabled={saving}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next = e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i;
                if (discard()) {
                  setTab(["settlements", "settings"][next]);
                  document
                    .getElementById(
                      `${tabsId}-${["settlements", "settings"][next]}-tab`,
                    )
                    ?.focus();
                }
              }
            }}
            onClick={() => {
              if (discard()) {
                setTab(key);
                setNotice("");
              }
            }}
          >
            {t(key)}
          </button>
        ))}
      </nav>
      {loading && (
        <p role="status" className="ds-status">
          {t("loading")}
        </p>
      )}
      {error && (
        <div role="alert" className="ds-error">
          {t(error)}
          <button
            disabled={saving}
            onClick={() => {
              if (discard()) void refresh();
            }}
          >
            <RefreshCw size={14} />
            {t("retry")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="ds-success">
          {t(notice)}
        </p>
      )}
      {datesError && (
        <div role="alert" className="ds-error">
          {t("deliveryDateMissing")}: {t(datesError)}
          <button disabled={saving} onClick={() => { if (discard()) void refresh(); }}>
            <RefreshCw size={14} />{t("retry")}
          </button>
        </div>
      )}
      <section
        role="tabpanel"
        id={`${tabsId}-${tab}-panel`}
        aria-labelledby={`${tabsId}-${tab}-tab`}
      >
        {tab === "settings" ? (
          <>
            <header className="ds-heading">
              <div>
                <h1>{t("settings")}</h1>
                <p>{t("subtitle")}</p>
              </div>
              <label>
                {t("apply")}
                <select
                  disabled={loading || saving}
                  value={scope}
                  onChange={(e) => {
                    if (discard()) {
                      setScope(e.target.value);
                      setNotice("");
                    }
                  }}
                >
                  <option value="">{t("companyDefaults")}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </header>
            <SettingsPanel
              key={`${scope}:${record.version}:${loading}`}
              record={record}
              saveSettings={settingsApi.writeCalculationSettings}
              scope={scope}
              canWrite={canWrite}
              readOnly={!canManageAccounting}
              onDirty={dirty}
              onSaving={onSaving}
              onReload={() => { if (discard()) void refresh(); }}
              onSaved={(next) => {
                setRecord(next);
                setNotice("saved");
              }}
            />
          </>
        ) : (
          <>
            <header className="ds-heading">
              <div>
                <h1>{t("settlements")}</h1>
                <p>{t("savedOnly")}</p>
              </div>
              <button
                className="ds-primary"
                disabled={!calculation}
                onClick={preview}
              >
                <FileText size={16} />
                {t("export")}
              </button>
            </header>
            <section className="ds-filters ds-panel">
              <label>
                {t("driver")}
                <select
                  value={driver}
                  onChange={(e) => {
                    setDriver(e.target.value);
                    setSelected(new Set());
                  }}
                >
                  <option value="">{t("chooseDriver")}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ds-period-buttons">
                {["week", "month", "manual"].map((k) => (
                  <button
                    aria-pressed={mode === k}
                    key={k}
                    onClick={() => {
                      setMode(k);
                      setSelected(new Set());
                      if (k !== "manual")
                        setPeriod(
                          periodFor(
                            k,
                            period.from || displayDayKey(new Date()),
                          ),
                        );
                    }}
                  >
                    {t(k)}
                  </button>
                ))}
              </div>
              <AccountingDateFilter
                key={mode}
                iconOnly
                allowReset={false}
                value={period}
                periodForDate={
                  mode === "manual"
                    ? undefined
                    : (date) => periodFor(mode, date)
                }
                onChange={(range) => {
                  setPeriod(range);
                  setSelected(new Set());
                }}
              />
            </section>
            <p className="ds-muted ds-period-note">
              {t(mode === "manual" ? "manualHint" : "dateBasis")}
            </p>
            <section className="ds-panel">
              <div className="ds-table-scroll">
                <table className="ds-load-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          aria-label={t("all")}
                          type="checkbox"
                          checked={
                            !!visible.length && chosen.length === visible.length
                          }
                          ref={(node) => {
                            if (node)
                              node.indeterminate =
                                chosen.length > 0 &&
                                chosen.length < visible.length;
                          }}
                          disabled={!visible.length}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? new Set(visible.map((l) => l.id))
                                : new Set(),
                            )
                          }
                        />
                      </th>
                      {["number", "route", "date", "miles", "perMile", "gross"].map(
                        (k) => (
                          <th key={k}>{t(k)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <input
                            aria-label={`${t("number")} ${l.loadNumber}`}
                            type="checkbox"
                            checked={selected.has(l.id)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(l.id);
                                else next.delete(l.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="ds-link"
                            onClick={() => onOpenLoad?.(l)}
                          >
                            {l.loadNumber}
                          </button>
                        </td>
                        <td>
                          {place(l.origin)} → {place(l.destination)}
                        </td>
                        <td className="ds-delivery-date">
                          {l.deliveredAt ? (
                            <time dateTime={l.deliveredAt}>{day(l.deliveredAt)}</time>
                          ) : (
                            <span className="ds-muted">{t("deliveryDateMissing")}</span>
                          )}
                        </td>
                        <td>
                          {accountingMiles(l) == null
                            ? "—"
                            : accountingMiles(l).toLocaleString()}
                        </td>
                        <td>
                          {usd(
                            loadRateCents(l) != null && accountingMiles(l) > 0
                              ? loadRateCents(l) / 100 / accountingMiles(l)
                              : null,
                          )}
                        </td>
                        <td>
                          {usd(
                            loadRateCents(l) == null
                              ? null
                              : loadRateCents(l) / 100,
                          )}
                        </td>
                      </tr>
                    ))}
                    {!visible.length && (
                      <tr>
                        <td className="ds-empty" colSpan={7}>
                          {t(driver ? "empty" : "chooseDriver")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7}>
                        {t("selected")}: {chosen.length}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
            {!savedSettings && !loading && !error && (
              <p className="ds-status">{t("noSaved")}</p>
            )}
            {calculationError && (
              <p role="alert" className="ds-error">
                {t(calculationError)}
              </p>
            )}
            {calculation && (
              <section className="ds-calculation">
                <div className="ds-panel">
                  <h2>{t("deductionsPdf")}</h2>
                  <dl>
                    <div>
                      <dt>{t("company")}</dt>
                      <dd>−{usd(calculation.commission / 100)}</dd>
                    </div>
                    {calculation.deductions.map((r) => (
                      <div key={r.id}>
                        <dt>
                          {r.id.startsWith("custom_") ? r.label : t(r.id)}
                          <small>
                            {r.method === "percentage"
                              ? `${r.value}% · ${t(r.basis)}`
                              : `${usd(Number(r.value))} · ${t(r.frequency)}`}
                          </small>
                        </dt>
                        <dd>−{usd(r.amount / 100)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="ds-panel">
                  <dl>
                    <div>
                      <dt>{t("gross")}</dt>
                      <dd>{usd(calculation.gross / 100)}</dd>
                    </div>
                    <div>
                      <dt>{t("earnings")}</dt>
                      <dd>{usd(calculation.earnings / 100)}</dd>
                    </div>
                    <div>
                      <dt>{t("deducted")}</dt>
                      <dd>−{usd(calculation.deducted / 100)}</dd>
                    </div>
                  </dl>
                  <div className="ds-net">
                    <span>{t("net")}</span>
                    <strong>{usd(calculation.net / 100)}</strong>
                  </div>
                  {calculation.net < 0 && (
                    <p className="ds-error">{t("negative")}</p>
                  )}
                  <small>{t("draft")}</small>
                </div>
              </section>
            )}
          </>
        )}
      </section>
      {snapshot && (
        <Statement snapshot={snapshot} onClose={() => setSnapshot(null)} />
      )}
    </section>
  );
}
