import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSettings,
  normalizeSettings,
  calculateSettlement,
  periodDays,
  periodFor,
  effectiveSettings,
  importedSettings,
} from "./calculation.js";
const period = { from: "2026-07-20", to: "2026-07-26" };
const loads = [
  { id: "1", driverId: "a", rate: 5300, distanceMiles: 1417 },
  { id: "2", driverId: "a", rate: 3200, distanceMiles: 1210 },
];
function settings(changes = {}) {
  const c = defaultSettings();
  for (const [id, change] of Object.entries(changes)) {
    Object.assign(
      c.rules.find((r) => r.id === id),
      { enabled: true, ...change },
    );
  }
  return c;
}
test("source PDF example retains cents instead of inconsistent integer rounding", () => {
  const c = settings({
      company: { value: "10" },
      dispatch: { value: "0.5" },
      insurance: { value: "350" },
      eld: { value: "45" },
    }),
    r = calculateSettlement(loads, c, period);
  assert.deepEqual(
    [r.gross, r.commission, r.earnings, r.deducted, r.net, r.miles],
    [850000, 85000, 765000, 43750, 721250, 2627],
  );
});
test("weekly fee prorated for 3 days and applied once rather than per load", () => {
  assert.equal(
    calculateSettlement(loads, settings({ insurance: { value: "350" } }), {
      from: "2026-07-20",
      to: "2026-07-22",
    }).deducted,
    15000,
  );
});
test("weekly full-started policy", () => {
  const c = settings({ insurance: { value: "350" } });
  c.partialWeeks = "full";
  assert.equal(
    calculateSettlement(loads, c, { from: "2026-07-20", to: "2026-07-27" })
      .deducted,
    70000,
  );
});
test("monthly amount prorates each calendar month including leap year", () => {
  const c = settings({ truck: { value: "290", frequency: "monthly" } });
  assert.equal(
    calculateSettlement(loads, c, { from: "2024-02-01", to: "2024-02-29" })
      .deducted,
    29000,
  );
  assert.equal(
    calculateSettlement(loads, c, { from: "2024-02-29", to: "2024-03-01" })
      .deducted,
    1935,
  );
});
test("percentage bases and fixed per-load fees", () => {
  const c = settings({
    company: { value: "10" },
    dispatch: { value: "10", basis: "after_company" },
    check: { value: "5", frequency: "per_load" },
  });
  const r = calculateSettlement(loads, c, period);
  assert.equal(r.deducted, 77500);
  assert.equal(r.net, 687500);
});
test("one-time charges apply once to a monthly selection", () =>
  assert.equal(
    calculateSettlement(loads, settings({ check: { value: "100" } }), {
      from: "2026-07-01",
      to: "2026-07-31",
    }).deducted,
    10000,
  ));
test("company per-settlement fixed charge allocated without cent loss", () => {
  const r = calculateSettlement(
    loads,
    settings({
      company: { method: "fixed", frequency: "per_settlement", value: "1.01" },
    }),
    period,
  );
  assert.equal(
    r.rows.reduce((s, x) => s + x.commission, 0),
    101,
  );
  assert.equal(r.commission, 101);
});
test("disabled rules retain amounts without being charged", () => {
  const c = settings({ insurance: { value: "350", enabled: false } });
  assert.equal(calculateSettlement(loads, c, period).deducted, 0);
});
test("unknown prices and currencies fail closed", () => {
  assert.throws(
    () =>
      calculateSettlement(
        [{ ...loads[0], rateKnown: false }],
        defaultSettings(),
        period,
      ),
    /unknownGross/,
  );
  assert.throws(
    () =>
      calculateSettlement(
        [{ ...loads[0], currency: "EUR" }],
        defaultSettings(),
        period,
      ),
    /currency/,
  );
});
test("selection validates empty, duplicate and mixed driver loads", () => {
  for (const x of [
    [],
    [loads[0], loads[0]],
    [loads[0], { ...loads[1], driverId: "b" }],
  ])
    assert.throws(() => calculateSettlement(x, defaultSettings(), period));
});
test("zero and unknown miles remain distinct", () => {
  assert.equal(
    calculateSettlement(
      [{ ...loads[0], distanceMiles: 0 }],
      defaultSettings(),
      period,
    ).miles,
    0,
  );
  assert.equal(
    calculateSettlement(
      [{ ...loads[0], distanceKnown: false }],
      defaultSettings(),
      period,
    ).miles,
    null,
  );
});
test("calendar boundaries and invalid dates", () => {
  assert.equal(periodDays({ from: "2026-03-07", to: "2026-03-09" }), 3);
  assert.deepEqual(periodFor("month", "2024-02-14"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.throws(() => periodDays({ from: "2026-02-30", to: "2026-03-10" }));
});
test("malformed rates, duplicate rules and recursive company basis rejected", () => {
  for (const change of [
    { value: "101" },
    { value: "-1" },
    { value: "1.001" },
    { basis: "after_company" },
    { frequency: "weekly" },
  ])
    assert.throws(() => normalizeSettings(settings({ company: change })));
  const c = defaultSettings();
  c.rules.push(c.rules[0]);
  assert.throws(() => normalizeSettings(c));
});
test("legacy defaults migrate and driver overrides inherit correctly", () => {
  const record = {
    broker_commission_percent: "10",
    settlement_defaults: { insurance_weekly: "350" },
  };
  assert.equal(
    importedSettings(record).rules.find((r) => r.id === "insurance").value,
    "350",
  );
  const c = settings({ company: { value: "15" } });
  record.settlement_defaults.driver_settlement_v1 = { drivers: { a: c } };
  assert.equal(effectiveSettings(record, "a").rules[0].value, "15");
  assert.equal(effectiveSettings(record, "b").rules[0].value, "10");
});
test("negative net remains visible, excessive company fee rejected", () => {
  assert.equal(
    calculateSettlement(loads, settings({ check: { value: "9000" } }), period)
      .net,
    -50000,
  );
  assert.throws(
    () =>
      calculateSettlement(
        loads,
        settings({ company: { method: "fixed", value: "9000" } }),
        period,
      ),
    /overCommission/,
  );
});

test("fixed company fee cannot exceed one load gross even if total earnings are positive", () => {
  assert.throws(
    () =>
      calculateSettlement(
        [
          { ...loads[0], rate: 100 },
          { ...loads[1], rate: 1000 },
        ],
        settings({
          company: { method: "fixed", value: "200" },
          dispatch: {
            value: "10",
            basis: "after_company",
            frequency: "per_load",
          },
        }),
        period,
      ),
    /overCommission/,
  );
});
