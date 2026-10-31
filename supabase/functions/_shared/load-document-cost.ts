// Standard text-token rates, USD / 1M, checked 2026-10-31 against official
// model pages. This is an estimate, not an invoice; unknown models stay null.
export function documentTokenCost(model: string, usage: any): number | null {
  const rates = model === "gpt-4.1-mini" || model.startsWith("gpt-4.1-mini-")
    ? [0.4, 0.1, 1.6]
    : model === "gpt-5-mini" || model.startsWith("gpt-5-mini-")
    ? [0.25, 0.025, 2]
    : null;
  if (
    !rates || !usage || !Number.isFinite(usage.input_tokens) ||
    !Number.isFinite(usage.output_tokens)
  ) return null;
  const cached = Math.min(
    usage.input_tokens,
    Math.max(0, usage.input_tokens_details?.cached_tokens ?? 0),
  );
  return ((usage.input_tokens - cached) * rates[0] + cached * rates[1] +
    usage.output_tokens * rates[2]) / 1_000_000;
}
