// Largest-remainder allocation in integer cents; signed document adjustments
// use the same rule. The original PDF row order breaks equal-remainder ties.
export function allocateCents(amount, weights) {
  if (!Number.isSafeInteger(amount) || !weights.length || weights.some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('ANALYTICS_INVALID_SETTLEMENT');
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  const denominator = sum || BigInt(weights.length), sign = amount < 0 ? -1 : 1;
  const parts = weights.map((weight, index) => {
    const product = BigInt(Math.abs(amount)) * (sum ? BigInt(weight) : 1n);
    return { index, value: Number(product / denominator), remainder: product % denominator };
  });
  let remaining = Math.abs(amount) - parts.reduce((a, b) => a + b.value, 0);
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!remaining) break;
    part.value++; remaining--;
  }
  return parts.map(part => part.value * sign);
}

export function settlementAllocations(statement) {
  const c = statement.calculation;
  const invalid = () => { throw Error('ANALYTICS_INVALID_SETTLEMENT'); };
  if (!statement.id || !statement.driverId || !Array.isArray(c?.rows) || !c.rows.length || !Array.isArray(c.deductions)) invalid();
  const integer = n => Number.isSafeInteger(n);
  if (![c.gross, c.commission, c.earnings, c.deducted, c.net].every(integer) || c.net < 0) invalid();
  const seen = new Set();
  for (const row of c.rows) {
    if (!row.load?.id || seen.has(row.load.id) || ![row.gross, row.commission, row.net ?? row.gross - row.commission].every(integer) || row.gross < 0) invalid();
    seen.add(row.load.id);
  }
  if (c.deductions.some(d => !integer(d.amount))
    || c.rows.reduce((s, r) => s + r.gross, 0) !== c.gross
    || c.rows.reduce((s, r) => s + r.commission, 0) !== c.commission
    || c.rows.reduce((s, r) => s + (r.net ?? r.gross - r.commission), 0) !== c.earnings
    || c.deductions.reduce((s, d) => s + d.amount, 0) !== c.deducted
    || c.earnings - c.deducted !== c.net) invalid();
  const weights = c.rows.map(row => row.gross);
  const dispatchTotal = c.deductions.filter(d => d.id === 'dispatch').reduce((s, d) => s + d.amount, 0);
  const dispatch = allocateCents(dispatchTotal, weights), other = allocateCents(c.deducted - dispatchTotal, weights);
  return c.rows.map((row, i) => ({
    id: row.load.id, driverId: statement.driverId, statementId: statement.id, statementNumber: statement.number,
    gross: row.gross, company: row.commission, dispatch: dispatch[i], other: other[i],
    approvedEarnings: row.net ?? row.gross - row.commission,
    net: (row.net ?? row.gross - row.commission) - dispatch[i] - other[i],
    miles: row.miles ?? null, netSource: 'approved',
  }));
}
