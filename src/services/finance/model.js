export const ACCOUNT_CODES = [
  "1000",
  "1100",
  "1150",
  "2000",
  "2100",
  "4000",
  "4100",
  "5000",
  "5100",
  "5200",
  "5300",
  "5400",
  "5500",
  "5600",
  "5700",
];
export const EXPENSE_CODES = [
  "5100",
  "5200",
  "5300",
  "5400",
  "5500",
  "5600",
  "5700",
];
export const EMPTY_FINANCE = {
  documents: [],
  loads: [],
  payments: [],
  credits: [],
  rules: [],
  recurring: [],
  journal: [],
};
export function cents(value) {
  if (value == null || !/^\d{1,12}(\.\d{1,2})?$/.test(String(value)))
    return null;
  const [whole, decimal = ""] = String(value).split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
export function signedCents(value) {
  const sign = String(value).startsWith("-") ? -1 : 1;
  const result = cents(String(value).replace(/^-/, ""));
  return result == null ? null : sign * result;
}
export const remaining = (doc) =>
  Math.max(
    0,
    (cents(doc.total) ?? 0) -
      (cents(doc.kind === "advance" ? doc.recovered : doc.paid) ?? 0) -
      (doc.kind === "advance" ? 0 : (cents(doc.credited) ?? 0)),
  );
export function documentState(doc, today) {
  if (doc.status !== "posted") return doc.status;
  if (remaining(doc) === 0) return "paid";
  if (doc.kind === "advance")
    return Number(doc.recovered) > 0 ? "partial" : "open";
  if (doc.due_date < today) return "overdue";
  return Number(doc.paid) > 0 ? "partial" : "open";
}
export function eligibleLoad(load, kind, driverId, broker) {
  if (!["delivered", "completed"].includes(load.status) || load.reconfirmation)
    return false;
  if (kind === "invoice")
    return (
      !load.invoice_id &&
      load.gross != null &&
      (!broker || load.broker === broker)
    );
  return Boolean(
    !load.settlement_id &&
      load.assignment_id &&
      load.driver_id === driverId &&
      load.status === "completed" &&
      load.completed_at,
  );
}
export function trialBalance(journal, from = "", to = "") {
  const result = Object.fromEntries(
    ACCOUNT_CODES.map((code) => [code, { code, debit: 0, credit: 0 }]),
  );
  for (const entry of journal) {
    if ((from && entry.entry_date < from) || (to && entry.entry_date > to))
      continue;
    for (const line of entry.entries) {
      if (!result[line.account]) throw new Error("FINANCE_ACCOUNT");
      const debit = cents(line.debit),
        credit = cents(line.credit);
      if (debit == null || credit == null)
        throw new Error("FINANCE_UNBALANCED");
      result[line.account].debit += debit;
      result[line.account].credit += credit;
    }
  }
  return Object.values(result).map((row) => ({
    ...row,
    balance: row.debit - row.credit,
  }));
}
export function financeSummary(data, today, from = "", to = "") {
  const docs = data.documents.filter((doc) => doc.status === "posted");
  const ledger = trialBalance(data.journal, from, to);
  const balance = (code) =>
    ledger.find((row) => row.code === code)?.balance || 0;
  const revenue = -balance("4000") - balance("4100");
  const expense = ledger
    .filter((row) => row.code.startsWith("5"))
    .reduce((sum, row) => sum + row.balance, 0);
  return {
    receivable: docs
      .filter((d) => d.kind === "invoice")
      .reduce((sum, d) => sum + remaining(d), 0),
    payable: docs
      .filter((d) => ["expense", "settlement"].includes(d.kind))
      .reduce((sum, d) => sum + remaining(d), 0),
    overdue: docs
      .filter(
        (d) => d.kind === "invoice" && documentState(d, today) === "overdue",
      )
      .reduce((sum, d) => sum + remaining(d), 0),
    cashMovement: balance("1000"),
    revenue,
    expense,
    profit: revenue - expense,
    ledger,
  };
}
export function aging(documents, today, kind) {
  const totals = [0, 0, 0, 0, 0];
  for (const doc of documents.filter(
    (d) => d.kind === kind && d.status === "posted" && remaining(d) > 0,
  )) {
    const days = Math.floor(
      (Date.parse(today + "T00:00:00Z") -
        Date.parse(doc.due_date + "T00:00:00Z")) /
        86400000,
    );
    totals[
      days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4
    ] += remaining(doc);
  }
  return totals;
}
// Spreadsheet formulas must remain text on CSV export.
export function csv(rows) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function downloadCsv(name, rows) {
  const url = URL.createObjectURL(
    new Blob([csv(rows)], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function driverReport(documents, from = "", to = "") {
  const groups = new Map();
  for (const doc of documents.filter(
    (d) =>
      d.kind === "settlement" &&
      d.status === "posted" &&
      (!from || d.document_date >= from) &&
      (!to || d.document_date <= to),
  )) {
    const row = groups.get(doc.driver_id) || {
      driverId: doc.driver_id,
      name: doc.counterparty,
      earnings: 0,
      adjustments: 0,
      total: 0,
      paid: 0,
      loads: 0,
    };
    for (const line of doc.lines) {
      const amount = signedCents(line.amount);
      if (amount == null) throw new Error("FINANCE_INVALID_LINE");
      if (line.type === "earning") {
        row.earnings += amount;
        row.loads++;
      } else row.adjustments += amount;
    }
    row.total += cents(doc.total);
    row.paid += cents(doc.paid);
    groups.set(doc.driver_id, row);
  }
  return [...groups.values()];
}
