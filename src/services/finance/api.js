import { requireSupabase } from "../../lib/supabase";
async function command(name, args, signal) {
  let request = requireSupabase().rpc(name, args);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
export const readFinance = (signal) => command("finance_workspace", {}, signal);
export const createDocument = (operationId, kind, payload) =>
  command("finance_create_document", {
    p_operation_id: operationId,
    p_kind: kind,
    p_payload: payload,
  });
export const documentAction = (doc, action, reason = "") =>
  command("finance_document_action", {
    p_id: doc.id,
    p_version: doc.version,
    p_action: action,
    p_reason: reason,
  });
export const recordPayment = (operationId, doc, values) =>
  command("finance_record_payment", {
    p_operation_id: operationId,
    p_id: doc.id,
    p_amount: values.amount,
    p_date: values.date,
    p_method: values.method,
    p_reference: values.reference,
  });
export const paymentAction = (id, action, reason = "") =>
  command("finance_payment_action", {
    p_id: id,
    p_action: action,
    p_reason: reason,
  });
export const savePayRule = (driver, version, values) =>
  command("finance_save_rule", {
    p_driver: driver,
    p_version: version,
    p_mode: values.mode,
    p_rate: values.rate,
    p_empty_rate: "0",
    p_snapshot: values.snapshot,
  });
export const recurringCommand = (operationId, payload) =>
  command("finance_recurring_command", {
    p_operation_id: operationId,
    p_payload: payload,
  });
export { financeError } from "./errors";

export const creditInvoice = (operationId, doc, values) =>
  command("finance_credit_invoice", {
    p_operation_id: operationId,
    p_id: doc.id,
    p_amount: values.amount,
    p_reason: values.reason,
    p_account: values.account,
  });
export const voidCredit = (id, reason) =>
  command("finance_void_credit", { p_id: id, p_reason: reason });

export const saveCompanyDefaults = (version, fee) =>
  command("finance_save_defaults", {
    p_version: version,
    p_fee_percent: fee === "" ? null : fee,
  });
