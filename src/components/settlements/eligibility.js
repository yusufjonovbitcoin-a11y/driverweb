import { normalizeSettings } from "./calculation.js";

export function eligibleSettlementLoad(load, driver) {
  return Boolean(load?.id && driver && load.driverId === driver &&
    !load.trashedAt && !["cancelled", "canceled", "offered", "offer", "draft"].includes(load.databaseStatus));
}

export function hasSavedSettings(record, driver) {
  if (!record || !(record.version > 0)) return false;
  const envelope = record.settlement_defaults?.driver_settlement_v1;
  const settings = envelope?.drivers?.[driver] || envelope?.company;
  if (settings) {
    try { normalizeSettings(settings); return true; } catch { return false; }
  }
  // Saving only one driver's override does not configure the remaining drivers.
  if (envelope) return false;
  return record.broker_commission_percent != null;
}
