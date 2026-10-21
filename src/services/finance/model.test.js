import test from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  remaining,
  documentState,
  trialBalance,
  financeSummary,
  aging,
  eligibleLoad,
  csv,
  driverReport,
} from "./model.js";
test("money parsing rejects nonfinancial values and preserves exact cents", () => {
  assert.equal(cents("12.05"), 1205);
  for (const value of ["NaN", "Infinity", "1.005", "-1", "", null])
    assert.equal(cents(value), null);
});
test("partial payment, overdue, void and advance recoveries use distinct states", () => {
  const doc = {
    kind: "invoice",
    status: "posted",
    total: 100,
    paid: 30,
    due_date: "2026-10-10",
  };
  assert.equal(remaining(doc), 7000);
  assert.equal(documentState(doc, "2026-10-16"), "overdue");
  assert.equal(
    documentState({ ...doc, due_date: "2026-10-20" }, "2026-10-16"),
    "partial",
  );
  assert.equal(documentState({ ...doc, paid: 100 }, "2026-10-16"), "paid");
  assert.equal(documentState({ ...doc, status: "void" }, "2026-10-16"), "void");
  assert.equal(
    remaining({ ...doc, kind: "advance", recovered: 40, applied: 60 }),
    6000,
  );
  assert.equal(
    documentState({ ...doc, kind: "advance", recovered: 40 }, "2026-10-16"),
    "partial",
  );
});
test("balanced ledger distinguishes accrual result from cash movement and scopes report dates", () => {
  const entries = [
    {
      entry_date: "2026-10-01",
      entries: [
        { account: "1100", debit: 100, credit: 0 },
        { account: "4000", debit: 0, credit: 100 },
      ],
    },
    {
      entry_date: "2026-10-10",
      entries: [
        { account: "1000", debit: 40, credit: 0 },
        { account: "1100", debit: 0, credit: 40 },
      ],
    },
  ];
  const summary = financeSummary(
    { documents: [], journal: entries },
    "2026-10-16",
  );
  assert.equal(summary.profit, 10000);
  assert.equal(summary.cashMovement, 4000);
  assert.equal(trialBalance(entries, "2026-10-02")[0].debit, 4000);
  assert.equal(
    summary.ledger.reduce((sum, row) => sum + row.balance, 0),
    0,
  );
});
test("aging buckets cover remaining posted amounts, never drafts or voids", () => {
  const docs = [
    {
      kind: "invoice",
      status: "posted",
      total: 100,
      paid: 30,
      due_date: "2026-10-01",
    },
    {
      kind: "invoice",
      status: "draft",
      total: 500,
      paid: 0,
      due_date: "2026-01-01",
    },
  ];
  assert.deepEqual(aging(docs, "2026-10-16", "invoice"), [0, 7000, 0, 0, 0]);
});
test("eligibility refuses duplicate and unfinished driver assignments", () => {
  assert.equal(
    eligibleLoad(
      {
        status: "completed",
        assignment_id: "a",
        completed_at: "2026-10-10",
        driver_id: "d",
      },
      "settlement",
      "d",
    ),
    true,
  );
  assert.equal(
    eligibleLoad(
      { status: "delivered", assignment_id: "a", driver_id: "d" },
      "settlement",
      "d",
    ),
    false,
  );
  assert.equal(
    eligibleLoad(
      { status: "completed", invoice_id: "i", gross: 100 },
      "invoice",
    ),
    false,
  );
});
test("CSV neutralizes spreadsheet formula injection", () => {
  assert.match(csv([['=HYPERLINK("x")', "safe"]]), /'=HYPERLINK/);
});
test("driver report counts only posted settlements and keeps signed adjustments", () => {
  const row = {
    kind: "settlement",
    status: "posted",
    document_date: "2026-10-10",
    driver_id: "d",
    counterparty: "Test",
    total: 850,
    paid: 400,
    lines: [
      { type: "earning", amount: 900 },
      { type: "deduction", amount: -100 },
      { type: "reimbursement", amount: 50 },
    ],
  };
  assert.deepEqual(driverReport([row, { ...row, status: "draft" }]), [
    {
      driverId: "d",
      name: "Test",
      loads: 1,
      earnings: 90000,
      adjustments: -5000,
      total: 85000,
      paid: 40000,
    },
  ]);
});
