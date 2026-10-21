import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  RULES,
  effectiveSettings,
  importedSettings,
  normalizeSettings,
} from "./calculation";
import { settingsError, writeCalculationSettings } from "./api";
import { useSettlementText } from "./text";
function Toggle({ label, checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className="ds-toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export default function SettingsPanel({
  record,
  scope,
  canWrite,
  readOnly = false,
  onSaved,
  onDirty,
  onReload,
  onSaving,
  saveSettings = writeCalculationSettings,
}) {
  const t = useSettlementText();
  const original = effectiveSettings(record, scope),
    originallyInherited =
      !!scope &&
      !record?.settlement_defaults?.driver_settlement_v1?.drivers?.[scope];
  const [config, setConfig] = useState(() => structuredClone(original)),
    [inherit, setInherit] = useState(originallyInherited),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
    canWrite &&
    (inherit !== originallyInherited ||
      (!inherit && JSON.stringify(config) !== JSON.stringify(original)));
  const needsInitialSave = !scope && record.version === 0;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const handle = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [dirty]);
  const disabled = !canWrite || busy,
    editDisabled = disabled || inherit;
  const displayed = inherit ? importedSettings(record) : config;
  function change(id, key, value) {
    setError("");
    setConfig((c) => ({
      ...c,
      rules: c.rules.map((r) =>
        r.id !== id
          ? r
          : {
              ...r,
              [key]: value,
              ...(key === "method" &&
              value === "percentage" &&
              !["per_load", "per_settlement"].includes(r.frequency)
                ? { frequency: "per_settlement" }
                : {}),
            },
      ),
    }));
  }
  async function save(e) {
    e.preventDefault();
    if (disabled || busy) return;
    setError("");
    setBusy(true);
    onSaving?.(true);
    try {
      const normalized = inherit ? null : normalizeSettings(config);
      const next = await saveSettings(scope, record.version, normalized);
      onSaved(next);
    } catch (err) {
      setError(settingsError(err));
    } finally {
      setBusy(false);
      onSaving?.(false);
    }
  }
  function options(values, value, label, onChange, off = false) {
    return (
      <select
        aria-label={label}
        value={value}
        disabled={editDisabled || off}
        onChange={(e) => onChange(e.target.value)}
      >
        {values.map((k) => (
          <option key={k} value={k}>
            {t(k)}
          </option>
        ))}
      </select>
    );
  }
  function table(group) {
    const rows = displayed.rules.filter((r) =>
      group === "other"
        ? RULES.find(([id]) => id === r.id)?.[2] === "other" ||
          r.id.startsWith("custom_")
        : RULES.find(([id]) => id === r.id)?.[2] === group,
    );
    return (
      <div className="ds-table-scroll">
        <table className="ds-settings-table">
          <thead>
            <tr>
              <th>{t("item")}</th>
              <th>{t("enabled")}</th>
              {group === "commissions" && <th>{t("method")}</th>}
              <th>{t("value")}</th>
              {group === "commissions" && <th>{t("basis")}</th>}
              <th>{t("frequency")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = r.id.startsWith("custom_") ? r.label : t(r.id),
                off = !r.enabled;
              return (
                <tr key={r.id}>
                  <td>
                    {r.id.startsWith("custom_") ? (
                      <div className="ds-custom">
                        <input
                          required
                          maxLength={100}
                          aria-label={t("newRule")}
                          disabled={editDisabled}
                          value={r.label}
                          onChange={(e) =>
                            change(r.id, "label", e.target.value)
                          }
                        />
                        <button
                          type="button"
                          aria-label={`${t("remove")} ${name}`}
                          disabled={editDisabled}
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              rules: c.rules.filter((x) => x.id !== r.id),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ) : (
                      name
                    )}
                  </td>
                  <td>
                    <Toggle
                      label={`${t("enabled")}: ${name}`}
                      disabled={editDisabled}
                      checked={r.enabled}
                      onChange={(v) => change(r.id, "enabled", v)}
                    />
                  </td>
                  {group === "commissions" && (
                    <td>
                      {options(
                        ["percentage", "fixed"],
                        r.method,
                        `${name}: ${t("method")}`,
                        (v) => change(r.id, "method", v),
                        off,
                      )}
                    </td>
                  )}
                  <td>
                    <div className="ds-value">
                      <input
                        aria-label={`${name}: ${t("value")}`}
                        type="number"
                        min="0"
                        max={r.method === "percentage" ? 100 : 9999999.99}
                        step="0.01"
                        required
                        disabled={editDisabled || off}
                        value={r.value}
                        onChange={(e) => change(r.id, "value", e.target.value)}
                      />
                      <span>{r.method === "percentage" ? "%" : "USD"}</span>
                    </div>
                  </td>
                  {group === "commissions" && (
                    <td>
                      {options(
                        r.id === "company"
                          ? ["gross"]
                          : ["gross", "after_company"],
                        r.basis,
                        `${name}: ${t("basis")}`,
                        (v) => change(r.id, "basis", v),
                        off,
                      )}
                    </td>
                  )}
                  <td>
                    {options(
                      r.method === "percentage" || r.id === "company"
                        ? ["per_load", "per_settlement"]
                        : ["weekly", "monthly", "per_settlement", "per_load"],
                      r.frequency,
                      `${name}: ${t("frequency")}`,
                      (v) => change(r.id, "frequency", v),
                      off,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <form className="ds-settings" onSubmit={save}>
      {scope && (
        <div className="ds-inherit">
          <Toggle
            label={t("inherit")}
            checked={inherit}
            disabled={disabled}
            onChange={setInherit}
          />
          <div>
            <strong>{t("inherit")}</strong>
            <small>{t("inheritHint")}</small>
          </div>
        </div>
      )}
      <section className="ds-panel">
        <header>
          <h2>1. {t("commissions")}</h2>
          <span>{t("grossHint")}</span>
        </header>
        {table("commissions")}
      </section>
      <section className="ds-panel">
        <header>
          <h2>2. {t("recurring")}</h2>
        </header>
        {table("recurring")}
        <div className="ds-partial">
          <label>
            {t("partial")}
            {options(
              ["prorate", "full"],
              displayed.partialWeeks,
              t("partial"),
              (v) => setConfig({ ...config, partialWeeks: v }),
            )}
          </label>
          <small>{t("monthHint")}</small>
        </div>
      </section>
      <section className="ds-panel">
        <header>
          <h2>3. {t("other")}</h2>
        </header>
        {table("other")}
        <button
          type="button"
          className="ds-add"
          disabled={editDisabled || config.rules.length >= 30}
          onClick={() =>
            setConfig((c) => ({
              ...c,
              rules: [
                ...c.rules,
                {
                  id: `custom_${crypto.randomUUID().replaceAll("-", "")}`,
                  label: "",
                  enabled: true,
                  method: "fixed",
                  value: "0.00",
                  basis: "gross",
                  frequency: "per_settlement",
                },
              ],
            }))
          }
        >
          <Plus size={15} />
          {t("add")}
        </button>
      </section>
      <section className="ds-panel ds-pdf-options">
        <h2>4. {t("pdf")}</h2>
        {[
          ["loads", "loadsPdf"],
          ["deductions", "deductionsPdf"],
          ["total", "totalPdf"],
        ].map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              disabled={editDisabled}
              checked={displayed.pdf[key]}
              onChange={(e) =>
                setConfig({
                  ...config,
                  pdf: { ...config.pdf, [key]: e.target.checked },
                })
              }
            />
            {t(label)}
          </label>
        ))}
        <span>USD</span>
      </section>
      {error && (
        <p role="alert" className="ds-error">
          {t(error)}
          {error === "conflict" && onReload && (
            <button type="button" disabled={busy} onClick={onReload}>
              {t("retry")}
            </button>
          )}
        </p>
      )}
      {readOnly && <p className="ds-muted">{t("permission")}</p>}
      <footer className="ds-savebar">
        <span className={dirty ? "ds-dirty" : ""}>
          {t(dirty ? "unsaved" : "unchanged")}
        </span>
        <div>
          <button
            type="button"
            disabled={disabled || !dirty}
            onClick={() => {
              setConfig(structuredClone(original));
              setInherit(originallyInherited);
              setError("");
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="ds-primary"
            disabled={disabled || !(dirty || needsInitialSave)}
          >
            <Save size={16} />
            {t(busy ? "saving" : "save")}
          </button>
        </div>
      </footer>
    </form>
  );
}
