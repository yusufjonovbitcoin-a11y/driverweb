import {
  assertEquals,
  assertLessOrEqual,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runPushDeliveryBatch } from "./push-delivery-runner.ts";

Deno.test("push delivery runner bounds concurrency", async () => {
  let active = 0;
  let observed = 0;
  const result = await runPushDeliveryBatch([1, 2, 3, 4, 5], {
    concurrency: 2,
    deadlineAt: Date.now() + 10_000,
    process: async (item) => {
      active += 1;
      observed = Math.max(observed, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    },
  });
  assertEquals(result.processed.length, 5);
  assertEquals(result.unprocessed.length, 0);
  assertLessOrEqual(observed, 2);
  assertLessOrEqual(result.maxObservedConcurrency, 2);
});

Deno.test("push delivery runner leaves work unprocessed after deadline", async () => {
  const result = await runPushDeliveryBatch([1, 2, 3], {
    concurrency: 2,
    deadlineAt: 99,
    now: () => 100,
    process: async (item) => item,
  });
  assertEquals(result.processed.length, 0);
  assertEquals(result.unprocessed, [1, 2, 3]);
  assertEquals(result.deadlineReached, true);
});

Deno.test("push delivery runner contains individual provider failures", async () => {
  const result = await runPushDeliveryBatch([1, 2, 3], {
    concurrency: 3,
    deadlineAt: Date.now() + 10_000,
    process: async (item) => {
      if (item === 2) throw new Error("provider timeout");
      return item;
    },
  });
  assertEquals(result.processed.length, 3);
  assertEquals(result.processed.filter((item) => item.error).length, 1);
  assertEquals(result.unprocessed.length, 0);
});
