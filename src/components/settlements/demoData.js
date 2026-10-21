import { defaultSettings, normalizeSettings } from "./calculation.js";
export const demoDrivers = [
  {
    id: "demo-driver-alex",
    name: "Alex Morgan · DEMO",
    truck: "UD3",
    email: "alex@example.com",
  },
  { id: "demo-driver-daniel", name: "Daniel Reed · DEMO" },
  { id: "demo-driver-sam", name: "Sam Wilson · DEMO" },
];
const routes = [
  ["Santa Ana", "CA", "Burleson", "TX", 5300, 1417, 0, 13],
  ["Temple", "TX", "Holland", "MI", 3200, 1210, 0, 16],
  ["Chicago", "IL", "Atlanta", "GA", 2800, 716, 1, 12],
  ["Atlanta", "GA", "Dallas", "TX", 3600, 782, 1, 14],
  ["Dallas", "TX", "Denver", "CO", 4100, 795, 1, 17],
  ["Phoenix", "AZ", "Los Angeles", "CA", 2200, 373, 2, 13],
  ["Los Angeles", "CA", "Sacramento", "CA", 1800, 384, 2, null],
];
export const demoLoads = routes.map(
  ([from, state, to, toState, rate, miles, driverIndex, date], index) => ({
    id: `demo-load-${index + 1}`,
    loadNumber: `DEMO-${1001 + index}`,
    driverId: demoDrivers[driverIndex].id,
    rate,
    rateKnown: true,
    currency: "USD",
    distanceMiles: miles,
    distanceKnown: true,
    origin: {
      city: from,
      state,
      date: date ? `2026-10-${String(date - 1).padStart(2, "0")}` : null,
    },
    destination: { city: to, state: toState },
    databaseStatus: date ? "delivered" : "assigned",
    deliveredAt: date ? `2026-10-${date}T16:00:00Z` : null,
  }),
);
export const demoInitialView = {
  tab: "settlements",
  driver: demoDrivers[0].id,
  period: { from: "2026-10-12", to: "2026-10-18" },
  selected: demoLoads
    .filter((l) => l.driverId === demoDrivers[0].id)
    .map((l) => l.id),
};
export function createDemoApi() {
  const company = defaultSettings();
  for (const [id, value] of [
    ["company", "10"],
    ["dispatch", "0.5"],
    ["insurance", "350"],
    ["eld", "45"],
  ])
    Object.assign(
      company.rules.find((r) => r.id === id),
      { enabled: true, value },
    );
  const override = structuredClone(company);
  Object.assign(
    override.rules.find((r) => r.id === "company"),
    { value: "8" },
  );
  Object.assign(
    override.rules.find((r) => r.id === "trailer"),
    { enabled: true, value: "200" },
  );
  Object.assign(
    override.rules.find((r) => r.id === "fuel"),
    { enabled: true, value: "375" },
  );
  let record = {
    version: 1,
    broker_commission_percent: "10",
    settlement_defaults: {
      driver_settlement_v1: {
        company: normalizeSettings(company),
        drivers: { [demoDrivers[1].id]: normalizeSettings(override) },
      },
    },
  };
  return {
    async readCalculationSettings() {
      return structuredClone(record);
    },
    async readDeliveryDates() {
      return Object.fromEntries(
        demoLoads
          .filter((l) => l.deliveredAt)
          .map((l) => [l.id, l.deliveredAt]),
      );
    },
    async writeCalculationSettings(driver, version, settings) {
      if (version !== record.version) throw Error("VERSION_CONFLICT");
      if (driver && !demoDrivers.some((d) => d.id === driver))
        throw Error("INVALID_DRIVER");
      if (!driver && settings === null) throw Error("INVALID");
      const normalized = settings === null ? null : normalizeSettings(settings);
      const next = structuredClone(record),
        envelope = next.settlement_defaults.driver_settlement_v1;
      if (driver) {
        if (normalized) envelope.drivers[driver] = normalized;
        else delete envelope.drivers[driver];
      } else envelope.company = normalized;
      next.version++;
      record = next;
      return structuredClone(record);
    },
  };
}
