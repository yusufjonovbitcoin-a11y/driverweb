import { stopCalendarDate } from "../../i18n/stopAppointment.js";
import { place } from "./calculation.js";
const fees = [
  ["trailer", "TRAILER"],
  ["truck", "TRUCK"],
  ["insurance", "TRUCK AND CARGO INSURANCE"],
  ["eld", "LOG BOOK"],
  ["check", "CHECK"],
  ["fuel", "FUEL"],
  ["zelle", "ZELLE"],
  ["dispatch", "DISPATCH FEE"],
  ["ifta", "IFTA"],
];
export const statementMoney = (value) =>
  Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function statementDate(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  return String(value);
}
export function statementModel(snapshot) {
  const c = snapshot.calculation;
  const deductions = fees.map(([id, name]) => {
    const rule = c.settings.rules.find((r) => r.id === id),
      applied = c.deductions.find((r) => r.id === id);
    const frequency =
      rule?.frequency === "weekly"
        ? " WEEKLY"
        : rule?.frequency === "monthly"
          ? " MONTHLY"
          : rule?.frequency === "per_load"
            ? " / LOAD"
            : "";
    const label =
      rule?.method === "percentage"
        ? `${name} ${Number(rule.value)}%`
        : name + frequency;
    return {
      label,
      amount: applied ? statementMoney(applied.amount / 100) : "",
    };
  });
  for (const rule of c.deductions.filter((r) => r.id.startsWith("custom_")))
    deductions.push({
      label: rule.label,
      amount: statementMoney(rule.amount / 100),
    });
  const columns = [
    "Load number",
    "PU",
    "DEL",
    "Pick Up Date",
    "$ Per Mile",
    "Miles",
    "Gross",
    "Net",
  ];
  const rows = c.rows.map((r) => [
    r.load.loadNumber,
    place(r.load.origin),
    place(r.load.destination),
    statementDate(
      stopCalendarDate(
        r.load.origin?.appointmentAt || r.load.origin?.date,
        r.load.origin?.timezone,
      ),
    ),
    r.miles > 0 ? statementMoney(r.gross / 100 / r.miles) : "—",
    r.miles == null ? "—" : String(r.miles),
    "$" + statementMoney(r.gross / 100),
    "$" + statementMoney((r.gross - r.commission) / 100),
  ]);
  return {
    columns,
    rows,
    deductions,
    totals: [
      "Total earnings",
      "",
      "",
      "",
      c.miles > 0 ? statementMoney(c.gross / 100 / c.miles) : "—",
      c.miles == null ? "—" : String(c.miles),
      "$" + statementMoney(c.gross / 100),
      "$" + statementMoney(c.earnings / 100),
    ],
    company:
      typeof snapshot.company === "string"
        ? { name: snapshot.company }
        : snapshot.company || { name: "T Fleets" },
  };
}
