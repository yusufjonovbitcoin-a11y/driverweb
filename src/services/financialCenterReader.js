import { settlementAllocations } from '../components/analytics/financialAllocation.js';

// One STABLE server statement supplies every financial input. A failed or
// malformed read never replaces the caller's previous complete snapshot.
export async function readFinancialCenter(client, signal) {
  let query = client.rpc('get_financial_center_snapshot');
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.total) || data.total < 0
    || !['rows', 'loads', 'pay', 'settlements'].every(key => Array.isArray(data[key]))
    || data.rows.length !== data.total || data.loads.length !== data.total
    || typeof data.settlementsAvailable !== 'boolean' || !Number.isFinite(Date.parse(data.fetchedAt))) throw Error('ANALYTICS_INVALID_RESPONSE');
  const unique = (rows, key) => {
    const ids = new Set();
    for (const row of rows) { if (!row?.[key] || ids.has(row[key])) throw Error('ANALYTICS_INVALID_RESPONSE'); ids.add(row[key]); }
    return ids;
  };
  const ids = unique(data.rows, 'id');
  for (const id of unique(data.loads, 'id')) if (!ids.has(id)) throw Error('ANALYTICS_INVALID_RESPONSE');
  unique(data.pay, 'assignment_id'); unique(data.settlements, 'id');
  const claimed = new Set();
  for (const statement of data.settlements) for (const row of settlementAllocations(statement)) {
    if (claimed.has(row.id)) throw Error('ANALYTICS_INVALID_SETTLEMENT');
    claimed.add(row.id);
  }
  return data;
}
