// Use an immutable unique key, not mutable updated_at ordering. Continue until
// empty even when the server's row cap is smaller than our requested page size.
export async function readAllRows(buildQuery, key = 'id', pageSize = 500) {
  const rows = [];
  let cursor = null;
  while (true) {
    let query = buildQuery().order(key, { ascending: true }).limit(pageSize);
    if (cursor !== null) query = query.gt(key, cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return rows;
    const next = data.at(-1)[key];
    if (next == null || (cursor !== null && next <= cursor)) {
      throw new Error('Pagination cursor did not advance');
    }
    rows.push(...data);
    cursor = next;
  }
}

export async function mapWithConcurrency(items, mapper, concurrency = 6) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

// For grouped views without a single unique non-null cursor column. The caller
// must provide a deterministic total order (including its tie-breaker).
export async function readAllPages(buildQuery, pageSize = 500) {
  const rows = [];
  while (true) {
    const { data, error } = await buildQuery().range(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
