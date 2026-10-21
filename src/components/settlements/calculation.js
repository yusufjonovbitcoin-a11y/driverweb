import {
  moneyCents,
  percentageBasisPoints,
  commissionCents,
  loadRateCents,
  accountingMiles,
} from "../accountingModel.js";

export const RULES = [
  ["company", "company", "commissions", "percentage", "per_load"],
  ["dispatch", "dispatch", "commissions", "percentage", "per_settlement"],
  ["truck", "truck", "recurring", "fixed", "weekly"],
  ["trailer", "trailer", "recurring", "fixed", "weekly"],
  ["insurance", "insurance", "recurring", "fixed", "weekly"],
  ["eld", "eld", "recurring", "fixed", "weekly"],
  ["fuel", "fuel", "recurring", "fixed", "weekly"],
  ["ifta", "ifta", "other", "fixed", "per_settlement"],
  ["check", "check", "other", "fixed", "per_settlement"],
  ["zelle", "zelle", "other", "fixed", "per_settlement"],
];
export function defaultSettings() {
  return {
    schema: 1,
    currency: "USD",
    partialWeeks: "prorate",
    pdf: { loads: true, deductions: true, total: true },
    rules: RULES.map(([id, , , method, frequency]) => ({
      id,
      enabled: false,
      method,
      frequency,
      basis: "gross",
      value: "0.00",
      label: "",
    })),
  };
}
export function importedSettings(record) {
  if (record?.settlement_defaults?.driver_settlement_v1?.company)
    return record.settlement_defaults.driver_settlement_v1.company;
  const c = defaultSettings(),
    legacy = record?.settlement_defaults || {};
  const map = {
    trailer: "trailer_weekly",
    truck: "truck_weekly",
    insurance: "insurance_weekly",
    eld: "logbook_weekly",
    fuel: "fuel_weekly",
    ifta: "ifta",
    check: "check",
    zelle: "zelle",
    dispatch: "dispatch_percent",
  };
  c.rules = c.rules.map((r) => {
    const v =
      r.id === "company"
        ? record?.broker_commission_percent
        : legacy[map[r.id]];
    return v == null ? r : { ...r, enabled: true, value: String(v) };
  });
  return c;
}
export function effectiveSettings(record, driver) {
  return (
    record?.settlement_defaults?.driver_settlement_v1?.drivers?.[driver] ||
    importedSettings(record)
  );
}
export function normalizeSettings(c) {
  if (
    !c ||
    c.schema !== 1 ||
    c.currency !== "USD" ||
    !["prorate", "full"].includes(c.partialWeeks) ||
    !Array.isArray(c.rules) ||
    c.rules.length < 10 ||
    c.rules.length > 30
  )
    throw Error("invalid");
  if (
    !c.pdf ||
    ["loads", "deductions", "total"].some((k) => typeof c.pdf[k] !== "boolean")
  )
    throw Error("invalid");
  const seen = new Set();
  const rules = c.rules.map((r) => {
    if (
      !r ||
      typeof r.id !== "string" ||
      seen.has(r.id) ||
      (!RULES.some(([id]) => id === r.id) &&
        !/^custom_[a-z0-9]{1,40}$/.test(r.id))
    )
      throw Error("invalid");
    seen.add(r.id);
    if (
      typeof r.enabled !== "boolean" ||
      !["fixed", "percentage"].includes(r.method) ||
      !["gross", "after_company"].includes(r.basis) ||
      !["per_load", "per_settlement", "weekly", "monthly"].includes(
        r.frequency,
      ) ||
      typeof r.label !== "string" ||
      r.label.length > 100 ||
      (r.id.startsWith("custom_") && !r.label.trim())
    )
      throw Error("invalid");
    if (
      r.id === "company" &&
      (r.basis !== "gross" ||
        !["per_load", "per_settlement"].includes(r.frequency))
    )
      throw Error("invalid");
    if (
      r.method === "percentage" &&
      !["per_load", "per_settlement"].includes(r.frequency)
    )
      throw Error("invalid");
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(String(r.value))) throw Error("invalid");
    const v =
      r.method === "percentage"
        ? percentageBasisPoints(r.value)
        : moneyCents(r.value);
    if (v == null || v > 999999999) throw Error("invalid");
    return { ...r, value: (v / 100).toFixed(2), label: r.label.trim() };
  });
  if (RULES.some(([id]) => !seen.has(id))) throw Error("invalid");
  return {
    schema: 1,
    currency: "USD",
    partialWeeks: c.partialWeeks,
    pdf: {
      loads: c.pdf.loads,
      deductions: c.pdf.deductions,
      total: c.pdf.total,
    },
    rules,
  };
}
const DAY = 86400000;
function utcDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null;
  const d = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(d) && new Date(d).toISOString().slice(0, 10) === s
    ? d
    : null;
}
export function periodDays(period) {
  const a = utcDay(period.from),
    b = utcDay(period.to);
  if (a == null || b == null || b < a || b - a > 3660 * DAY)
    throw Error("period");
  return (b - a) / DAY + 1;
}
export function periodFor(mode, date) {
  const d = utcDay(date);
  if (d == null) return { from: "", to: "" };
  const x = new Date(d);
  if (mode === "month")
    return {
      from: date.slice(0, 7) + "-01",
      to: new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10),
    };
  return { from: date, to: new Date(d + 6 * DAY).toISOString().slice(0, 10) };
}
function rounded(n, d) {
  return Number((BigInt(n) + BigInt(d) / 2n) / BigInt(d));
}
function monthly(amount, period) {
  let cursor = utcDay(period.from),
    end = utcDay(period.to),
    sum = 0;
  while (cursor <= end) {
    const d = new Date(cursor),
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
      days = new Date(next - DAY).getUTCDate(),
      used = (Math.min(end, next - DAY) - cursor) / DAY + 1;
    sum += rounded(BigInt(amount) * BigInt(used), days);
    cursor = next;
  }
  return sum;
}
export function calculateSettlement(loads, config, period) {
  const c = normalizeSettings(config),
    days = periodDays(period);
  if (!loads.length) throw Error("selectLoads");
  const ids = new Set();
  const rows = loads.map((l) => {
    if (!l.id || ids.has(l.id)) throw Error("invalid");
    ids.add(l.id);
    if (!l.driverId || l.driverId !== loads[0].driverId)
      throw Error("oneDriver");
    if ((l.currency || l.currencyCode || "USD").toUpperCase() !== "USD")
      throw Error("currency");
    const gross = loadRateCents(l);
    if (gross == null || gross > 999999999) throw Error("unknownGross");
    return { load: l, gross, miles: accountingMiles(l), commission: 0 };
  });
  const gross = rows.reduce((s, r) => s + r.gross, 0);
  if (!Number.isSafeInteger(gross)) throw Error("invalid");
  function amount(rule, base, perRow) {
    if (!rule.enabled) return 0;
    const v =
      rule.method === "percentage"
        ? percentageBasisPoints(rule.value)
        : moneyCents(rule.value);
    if (rule.method === "percentage")
      return rule.frequency === "per_load"
        ? perRow.reduce((s, n) => s + commissionCents(n, v), 0)
        : commissionCents(base, v);
    if (rule.frequency === "per_load") return v * rows.length;
    if (rule.frequency === "weekly")
      return c.partialWeeks === "full"
        ? v * Math.ceil(days / 7)
        : rounded(BigInt(v) * BigInt(days), 7);
    if (rule.frequency === "monthly") return monthly(v, period);
    return v;
  }
  const company = c.rules.find((r) => r.id === "company");
  const commission = amount(
    company,
    gross,
    rows.map((r) => r.gross),
  );
  if (company.enabled && company.frequency === "per_load")
    rows.forEach(
      (r) =>
        (r.commission =
          company.method === "percentage"
            ? commissionCents(r.gross, percentageBasisPoints(company.value))
            : moneyCents(company.value)),
    );
  else if (commission) {
    let allocated = 0;
    rows.forEach((r, i) => {
      r.commission =
        i === rows.length - 1
          ? commission - allocated
          : gross
            ? Math.min(
                commission - allocated,
                rounded(BigInt(commission) * BigInt(r.gross), gross),
              )
            : 0;
      allocated += r.commission;
    });
  }
  const earnings = gross - commission;
  if (earnings < 0 || rows.some((r) => r.commission > r.gross))
    throw Error("overCommission");
  const deductions = c.rules
    .filter((r) => r.enabled && r.id !== "company")
    .map((r) => ({
      ...r,
      amount: amount(
        r,
        r.basis === "gross" ? gross : earnings,
        rows.map((x) =>
          r.basis === "gross" ? x.gross : x.gross - x.commission,
        ),
      ),
    }));
  const deducted = deductions.reduce((s, r) => s + r.amount, 0);
  return {
    rows,
    gross,
    commission,
    earnings,
    deductions,
    deducted,
    net: earnings - deducted,
    miles: rows.some((r) => r.miles == null)
      ? null
      : rows.reduce((s, r) => s + r.miles, 0),
    settings: c,
    period,
    days,
  };
}

export const place = (p) =>
  [p?.city, p?.state].filter(Boolean).join(", ") || p?.address || "—";
