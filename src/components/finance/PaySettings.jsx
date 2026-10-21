import { usd, day } from "./format";
import { useRef, useState } from "react";
import {
  savePayRule,
  saveCompanyDefaults,
  recurringCommand,
  financeError,
} from "../../services/finance/api";
import { useFinanceText } from "./copy";
import { Field, MoneyInput } from "./common";
export default function PaySettings({
  data,
  drivers,
  today,
  canWrite,
  onChanged,
}) {
  const f = useFinanceText();
  const [driver, setDriver] = useState(drivers[0]?.id || ""),
    [editing, setEditing] = useState(null),
    [recurring, setRecurring] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [companyFee, setCompanyFee] = useState(null);
  async function saveDefault(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveCompanyDefaults(
        data.defaults?.version || 0,
        companyFee ??
          (data.defaults?.fee_percent == null
            ? ""
            : String(data.defaults.fee_percent)),
      );
      setCompanyFee(null);
      setNotice(f("ruleSaved"));
      await onChanged();
    } catch (err) {
      setError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  const operation = useRef(crypto.randomUUID());
  const rule = data.rules.find((row) => row.driver_id === driver);
  const [charge, setCharge] = useState({
    driver_id: driver,
    description: "",
    direction: "deduction",
    amount: "",
    starts_on: today,
    ends_on: "",
    interval_days: 7,
  });
  const values = editing || {
    mode: rule?.mode || "percentage",
    rate: rule?.rate == null ? "" : String(rule.rate),
    snapshot: rule?.require_assignment_snapshot !== false,
  };
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (recurring) {
        await recurringCommand(operation.current, charge);
        operation.current = crypto.randomUUID();
        setRecurring(false);
      } else {
        await savePayRule(driver, rule?.version || 0, values);
        setEditing(null);
        setNotice(f("ruleSaved"));
      }
      await onChanged();
    } catch (err) {
      setError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(row) {
    setBusy(true);
    setError("");
    try {
      await recurringCommand(crypto.randomUUID(), {
        id: row.id,
        version: row.version,
      });
      await onChanged();
    } catch (err) {
      setError(financeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fin-settings-layout">
      <section className="fin-panel fin-company-default">
        <form className="fin-settings-form" onSubmit={saveDefault}>
          <Field label={f("companyFee")}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              disabled={!canWrite || busy}
              value={
                companyFee ??
                (data.defaults?.fee_percent == null
                  ? ""
                  : String(data.defaults.fee_percent))
              }
              onChange={(event) => setCompanyFee(event.target.value)}
            />
          </Field>
          <p className="fin-help">{f("companyFeeHint")}</p>
          <button
            className="fin-button fin-primary"
            disabled={!canWrite || busy}
            type="submit"
          >
            {f(busy ? "saving" : "save")}
          </button>
        </form>
      </section>
      <section className="fin-panel">
        <header>
          <h2>{f("payMethod")}</h2>
        </header>
        <form className="fin-settings-form" onSubmit={save}>
          <fieldset disabled={!canWrite || busy}>
            <Field label={f("driver")}>
              <select
                value={driver}
                required
                onChange={(e) => {
                  setDriver(e.target.value);
                  setEditing(null);
                  setNotice("");
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
            <Field label={f("payMethod")}>
              <select
                value={values.mode}
                onChange={(e) =>
                  setEditing({ ...values, mode: e.target.value, rate: "" })
                }
              >
                {["percentage", "mileage", "flat"].map((mode) => (
                  <option key={mode} value={mode}>
                    {f(mode)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={`${f("rate")} · ${values.mode === "percentage" ? "%" : values.mode === "mileage" ? "USD / mi" : "USD"}`}
            >
              <input
                type="number"
                required
                min="0"
                max={values.mode === "flat" ? 999999 : 100}
                step="0.0001"
                value={values.rate}
                onChange={(e) =>
                  setEditing({ ...values, rate: e.target.value })
                }
              />
            </Field>
            {values.mode === "mileage" && (
              <label className="fin-check">
                <input
                  type="checkbox"
                  checked={values.snapshot}
                  onChange={(e) =>
                    setEditing({ ...values, snapshot: e.target.checked })
                  }
                />
                {f("snapshot")}
              </label>
            )}
            <p className="fin-help">{f("snapshotHint")}</p>
            <button
              type="submit"
              className="fin-button fin-primary"
              disabled={busy || !driver || recurring}
            >
              {f(busy ? "saving" : "save")}
            </button>
          </fieldset>
        </form>
      </section>
      <section className="fin-panel">
        <header>
          <h2>{f("recurring")}</h2>
          <button
            className="fin-button"
            disabled={!canWrite || busy}
            onClick={() => {
              setRecurring(!recurring);
              setCharge({ ...charge, driver_id: driver });
            }}
          >
            {f("create")}
          </button>
        </header>
        {recurring && (
          <form className="fin-settings-form" onSubmit={save}>
            <fieldset disabled={busy}>
              <Field label={f("driver")}>
                <select
                  required
                  value={charge.driver_id}
                  onChange={(e) =>
                    setCharge({ ...charge, driver_id: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={f("description")}>
                <input
                  required
                  maxLength={200}
                  value={charge.description}
                  onChange={(e) =>
                    setCharge({ ...charge, description: e.target.value })
                  }
                />
              </Field>
              <div className="fin-form-grid">
                <Field label={f("method")}>
                  <select
                    value={charge.direction}
                    onChange={(e) =>
                      setCharge({ ...charge, direction: e.target.value })
                    }
                  >
                    {["deduction", "addition"].map((type) => (
                      <option key={type} value={type}>
                        {f(type)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={f("amount")}>
                  <MoneyInput
                    value={charge.amount}
                    onChange={(e) =>
                      setCharge({ ...charge, amount: e.target.value })
                    }
                  />
                </Field>
                {["starts_on", "ends_on"].map((key) => (
                  <Field
                    key={key}
                    label={f(key === "starts_on" ? "starts" : "ends")}
                  >
                    <input
                      type="date"
                      required={key === "starts_on"}
                      min={key === "ends_on" ? charge.starts_on : undefined}
                      value={charge[key]}
                      onChange={(e) =>
                        setCharge({ ...charge, [key]: e.target.value })
                      }
                    />
                  </Field>
                ))}
                <Field label={f("interval")}>
                  <input
                    type="number"
                    required
                    min="1"
                    max="366"
                    step="1"
                    value={charge.interval_days}
                    onChange={(e) =>
                      setCharge({ ...charge, interval_days: e.target.value })
                    }
                  />
                </Field>
              </div>
              <button type="submit" className="fin-button fin-primary">
                {f(busy ? "saving" : "save")}
              </button>
            </fieldset>
          </form>
        )}
        <div className="fin-rule-list">
          {data.recurring.length ? (
            data.recurring.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.description}</strong>
                  <small>
                    {drivers.find((d) => d.id === row.driver_id)?.name} ·{" "}
                    {f(row.direction)} · {row.interval_days} {f("interval")} ·{" "}
                    {day(row.starts_on)}
                  </small>
                </div>
                <b>{usd(row.amount)}</b>
                <button
                  className="fin-button"
                  disabled={!canWrite || busy}
                  onClick={() => toggle(row)}
                >
                  {f(row.active ? "pause" : "enable")}
                </button>
              </article>
            ))
          ) : (
            <p className="fin-help">{f("noRecurring")}</p>
          )}
        </div>
      </section>
      {error && (
        <p className="fin-error" role="alert">
          {f("errors." + error)}
        </p>
      )}
      {notice && (
        <p role="status" className="fin-success">
          {notice}
        </p>
      )}
    </div>
  );
}
