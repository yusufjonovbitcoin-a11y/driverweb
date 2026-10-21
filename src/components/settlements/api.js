import { requireSupabase } from "../../lib/supabase";
import { normalizeSettings } from "./calculation";
export async function readCalculationSettings(signal) {
  let q = requireSupabase()
    .from("company_accounting_settings")
    .select("broker_commission_percent,settlement_defaults,version,updated_at")
    .maybeSingle();
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw error;
  return (
    data || {
      version: 0,
      settlement_defaults: {},
      broker_commission_percent: null,
    }
  );
}
export async function writeCalculationSettings(driver, version, settings) {
  const { data, error } = await requireSupabase().rpc(
    "save_driver_calculation_settings",
    {
      p_driver: driver || null,
      p_expected_version: version,
      p_settings: settings === null ? null : normalizeSettings(settings),
    },
  );
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
export function settingsError(err) {
  const s = String(err?.message || "");
  if (/VERSION_CONFLICT/.test(s)) return "conflict";
  if (/PERMISSION_DENIED/.test(s) || err?.code === "42501") return "permission";
  if (/INVALID/.test(s) || s === "invalid") return "invalid";
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(err?.code))
    return "setup";
  return "loadError";
}
export async function readDeliveryDates(signal) {
  let q = requireSupabase().rpc("driver_settlement_delivery_dates");
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw error;
  return data || {};
}
