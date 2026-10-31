export function financeError(error) {
  const message = String(error?.message || "");
  if (["PGRST202", "42883", "42P01"].includes(error?.code))
    return "notInstalled";
  if (error?.code === "23505") return "duplicate";
  if (
    error?.code === "23514" ||
    error?.code === "22P02" ||
    error?.code === "22007"
  )
    return "invalid";
  const code = message.match(/FINANCE_([A-Z_]+)/)?.[1];
  return (
    {
      PERMISSION: "permission",
      CONFLICT: "conflict",
      OVERPAYMENT: "overpayment",
      PAY_RULE: "payRule",
      SNAPSHOT_PENDING: "snapshotPending",
      RECURRING_USED: "duplicate",
      NOT_DELIVERED: "notDelivered",
      UNKNOWN_AMOUNT: "unknownAmount",
      HAS_PAYMENTS: "hasPayments",
      BROKER_MISMATCH: "brokerMismatch",
      ADVANCE_BALANCE: "advanceBalance",
      NEGATIVE_NET: "negativeNet",
      SELECT_LOADS: "selectLoads",
      ARCHIVE_REQUIRED: "tooMany",
      IDEMPOTENCY_MISMATCH: "conflict",
      INVALID_LINE: "invalid",
      INVALID_PAYMENT: "invalid",
      DATE: "invalid",
      DRIVER: "invalid",
      ASSIGNMENT: "conflict",
      PERIOD: "invalid",
      REASON: "reason",
      STATE: "state",
    }[code] || "failed"
  );
}
