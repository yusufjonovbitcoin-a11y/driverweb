export type DeliveryRunResult<T, R> = {
  processed: Array<{ item: T; result?: R; error?: unknown }>;
  unprocessed: T[];
  deadlineReached: boolean;
  maxObservedConcurrency: number;
};

export async function runPushDeliveryBatch<T, R>(
  items: T[],
  options: {
    concurrency: number;
    deadlineAt: number;
    now?: () => number;
    process: (item: T) => Promise<R>;
  },
): Promise<DeliveryRunResult<T, R>> {
  const now = options.now ?? Date.now;
  const concurrency = Math.min(Math.max(options.concurrency, 1), 8);
  const processed: Array<{ item: T; result?: R; error?: unknown }> = [];
  let cursor = 0;
  let active = 0;
  let maxObservedConcurrency = 0;

  while (cursor < items.length && now() < options.deadlineAt) {
    const chunk = items.slice(cursor, cursor + concurrency);
    cursor += chunk.length;
    const outcomes = await Promise.all(chunk.map(async (item) => {
      active += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
      try {
        return { item, result: await options.process(item) };
      } catch (error) {
        return { item, error };
      } finally {
        active -= 1;
      }
    }));
    processed.push(...outcomes);
  }

  return {
    processed,
    unprocessed: items.slice(cursor),
    deadlineReached: cursor < items.length,
    maxObservedConcurrency,
  };
}
