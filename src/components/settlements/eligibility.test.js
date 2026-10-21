import test from "node:test";
import assert from "node:assert/strict";
import { eligibleSettlementLoad, hasSavedSettings } from "./eligibility.js";
import { defaultSettings } from "./calculation.js";

test("manual calculation keeps assigned loads but excludes offers and invalid assignments", () => {
  const load = { id: "load", driverId: "driver", databaseStatus: "assigned" };
  assert.equal(eligibleSettlementLoad(load, "driver"), true);
  for (const databaseStatus of ["cancelled", "canceled", "offered", "offer", "draft"])
    assert.equal(eligibleSettlementLoad({ ...load, databaseStatus }, "driver"), false);
  for (const change of [{ trashedAt: "2026-10-18" }, { driverId: "other" }, { id: "" }])
    assert.equal(eligibleSettlementLoad({ ...load, ...change }, "driver"), false);
  assert.equal(eligibleSettlementLoad(load, ""), false);
  for (const databaseStatus of ["delivered", "completed"])
    assert.equal(eligibleSettlementLoad({ ...load, databaseStatus }, "driver"), true);
});

test("driver-only settings do not accidentally configure every driver", () => {
  const record = { version: 1, broker_commission_percent: 0,
    settlement_defaults: { driver_settlement_v1: { drivers: { a: defaultSettings() } } } };
  assert.equal(hasSavedSettings(record, "a"), true);
  assert.equal(hasSavedSettings(record, "b"), false);
  record.settlement_defaults.driver_settlement_v1.company = defaultSettings();
  assert.equal(hasSavedSettings(record, "b"), true);
  record.settlement_defaults.driver_settlement_v1.drivers.a = { schema: 0 };
  assert.equal(hasSavedSettings(record, "a"), false);
});

test("explicit saved legacy zero commission works, absent settings do not", () => {
  assert.equal(hasSavedSettings({ version: 0 }, "a"), false);
  assert.equal(hasSavedSettings({ version: 1, broker_commission_percent: null }, "a"), false);
  assert.equal(hasSavedSettings({ version: 1, broker_commission_percent: 0 }, "a"), true);
});
