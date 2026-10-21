async function rpc(name, args) {
  const response = await fetch("/__finance_qa_rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
export const readFinance = () => rpc("finance_workspace", []);
export const createDocument = (op, kind, payload) =>
  rpc("finance_create_document", [op, kind, payload]);
export const documentAction = (doc, action, reason = "") =>
  rpc("finance_document_action", [doc.id, doc.version, action, reason]);
export const recordPayment = (op, doc, p) =>
  rpc("finance_record_payment", [
    op,
    doc.id,
    p.amount,
    p.date,
    p.method,
    p.reference,
  ]);
export const paymentAction = (id, action, reason = "") =>
  rpc("finance_payment_action", [id, action, reason]);
export const savePayRule = (driver, version, values) =>
  rpc("finance_save_rule", [
    driver,
    version,
    values.mode,
    values.rate,
    0,
    values.snapshot,
  ]);
export const recurringCommand = (op, payload) =>
  rpc("finance_recurring_command", [op, payload]);
export { financeError } from "../../src/services/finance/errors";

export const creditInvoice = (op, doc, v) =>
  rpc("finance_credit_invoice", [op, doc.id, v.amount, v.reason, v.account]);
export const voidCredit = (id, reason) =>
  rpc("finance_void_credit", [id, reason]);

export const saveCompanyDefaults = (version, fee) =>
  rpc("finance_save_defaults", [version, fee === "" ? null : fee]);
