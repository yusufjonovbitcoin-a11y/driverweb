// A dedicated credential is accepted only for the bounded queue consumer. User
// requests still prove document visibility with their own session and RLS.
export function isDocumentCheckWorker(request: Request, expected: string | undefined) {
  const supplied = request.headers.get("X-Worker-Token") ?? "";
  if (!expected || !/^[0-9a-f]{64}$/.test(expected) || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function isFinancialDocumentDiscrepancy(item: Record<string, unknown>) {
  if (item.code === "rate_mismatch") return true;
  const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
  const field = String(params.field ?? "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return /(?:^|[^a-z])(?:rate|price|pay|payment|amount|revenue|margin|charge|cost|rpm)(?:$|[^a-z])/.test(field);
}

// Apply identically to fresh provider output and old cached responses. In
// operational reviews, free-form summaries/unknown fields are not a safe
// projection: older providers received broker prices. Never mutate the source.
export function sanitizeDocumentReview(value: unknown, financialReview: boolean): Record<string, unknown> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (financialReview) return source;
  const allowed = ["documentReadable", "documentMatchesLoad", "signaturePresent", "extractedLoadNumber",
    "extractedPickupAddress", "extractedDeliveryAddress", "confidence"];
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)));
  const raw = Array.isArray(source.discrepancies) ? source.discrepancies.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
  ) : [];
  const discrepancies = raw.filter((item) => !isFinancialDocumentDiscrepancy(item)).map((item) => {
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    return { code: item.code, severity: item.severity, params: {
      field: params.field ?? null, expected: params.expected ?? null, actual: params.actual ?? null,
    } };
  });
  result.discrepancies = discrepancies;
  if (raw.length && !discrepancies.length) result.documentMatchesLoad = true;
  return result;
}

export function documentComparisonStops(stops: Record<string, unknown>[], boundStopId: string | null) {
  const bound = boundStopId ? stops.find((stop) => stop.id === boundStopId) : undefined;
  const forRole = (role: string) => {
    if (bound?.type === role) return bound;
    const candidates = stops.filter((stop) => stop.type === role);
    // A document's scalar address cannot identify an arbitrary first stop on a
    // multi-stop route. An unbound counterpart is comparable only if unique.
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  return { pickup: forRole("pickup"), delivery: forRole("delivery") };
}

export function isUnscopedStopDiscrepancy(item: Record<string, unknown>, scope: ReturnType<typeof documentComparisonStops>) {
  const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
  const field = String(params.field ?? "").toLowerCase();
  const code = String(item.code ?? "");
  return (!scope.pickup && (code.startsWith("pickup_") || field.startsWith("pickup"))) ||
    (!scope.delivery && (code.startsWith("delivery_") || field.startsWith("delivery")));
}

export async function beforeDocumentDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Document review deadline exceeded")), Math.max(1, deadline - Date.now()));
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
