import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoApi,
  demoDrivers,
  demoLoads,
  demoInitialView,
} from "./demoData.js";
import { calculateSettlement, effectiveSettings } from "./calculation.js";
test("demo opens with two selected loads and exact source settlement total", async () => {
  const api = createDemoApi(),
    record = await api.readCalculationSettings();
  const selected = demoLoads.filter((l) =>
    demoInitialView.selected.includes(l.id),
  );
  const c = calculateSettlement(
    selected,
    effectiveSettings(record, demoInitialView.driver),
    demoInitialView.period,
  );
  assert.equal(demoDrivers.length, 3);
  assert.equal(demoLoads.length, 7);
  assert.equal(c.net, 721250);
});
test("demo writes stay in one isolated instance, clone records and enforce versions", async () => {
  const first = createDemoApi(),
    second = createDemoApi(),
    r = await first.readCalculationSettings();
  const config = effectiveSettings(r, demoDrivers[0].id);
  config.rules.find((r) => r.id === "company").value = "20";
  assert.equal(
    effectiveSettings(await first.readCalculationSettings(), demoDrivers[0].id)
      .rules[0].value,
    "10.00",
  );
  const saved = await first.writeCalculationSettings(null, 1, config);
  assert.equal(saved.version, 2);
  assert.equal(
    effectiveSettings(await second.readCalculationSettings(), demoDrivers[0].id)
      .rules[0].value,
    "10.00",
  );
  await assert.rejects(
    first.writeCalculationSettings(null, 1, config),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    first.writeCalculationSettings("real-driver", 2, config),
    /INVALID_DRIVER/,
  );
});
test("driver overrides can revert to company rules and undelivered loads have no date", async () => {
  const api = createDemoApi();
  let r = await api.readCalculationSettings();
  assert.equal(effectiveSettings(r, demoDrivers[1].id).rules[0].value, "8.00");
  r = await api.writeCalculationSettings(demoDrivers[1].id, 1, null);
  assert.equal(effectiveSettings(r, demoDrivers[1].id).rules[0].value, "10.00");
  assert.equal((await api.readDeliveryDates())["demo-load-7"], undefined);
});
