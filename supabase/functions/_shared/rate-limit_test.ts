import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkDistributedRateLimit,
  checkRateLimit,
  rateLimitResponse,
  resetRateLimitsForTest,
} from "./rate-limit.ts";

Deno.test("rate limiter blocks requests after the configured limit", () => {
  resetRateLimitsForTest();
  assertEquals(
    checkRateLimit("ai", "user-1", { limit: 2, windowMs: 1_000, now: 0 })
      .allowed,
    true,
  );
  assertEquals(
    checkRateLimit("ai", "user-1", { limit: 2, windowMs: 1_000, now: 1 })
      .allowed,
    true,
  );
  assertEquals(
    checkRateLimit("ai", "user-1", { limit: 2, windowMs: 1_000, now: 2 })
      .allowed,
    false,
  );
});

Deno.test("rate limiter resets after the window", () => {
  resetRateLimitsForTest();
  checkRateLimit("turn", "user-1", { limit: 1, windowMs: 1_000, now: 0 });
  assertEquals(
    checkRateLimit("turn", "user-1", { limit: 1, windowMs: 1_000, now: 1_001 })
      .allowed,
    true,
  );
});

Deno.test("distributed limiter delegates to the service-role RPC", async () => {
  resetRateLimitsForTest();
  let received: Record<string, unknown> | null = null;
  const result = await checkDistributedRateLimit(
    {
      rpc: (_name, args) => {
        received = args;
        return Promise.resolve({ data: true, error: null });
      },
    },
    "turn",
    "user-1",
    {
      limit: 3,
      windowMs: 60_000,
      supabaseUrl: "https://example.supabase.co",
    },
  );
  assertEquals(result.allowed, true);
  assertEquals(received, {
    scope: "turn",
    actor: "user-1",
    limit_count: 3,
    window_seconds: 60,
  });
});

Deno.test("distributed limiter fails closed in production", async () => {
  resetRateLimitsForTest();
  const result = await checkDistributedRateLimit(
    {
      rpc: () => Promise.resolve({ data: null, error: { message: "offline" } }),
    },
    "ai",
    "user-1",
    {
      limit: 3,
      windowMs: 60_000,
      supabaseUrl: "https://example.supabase.co",
    },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.unavailable, true);
  assertEquals(rateLimitResponse(result).status, 503);
});

Deno.test("distributed limiter keeps local development usable", async () => {
  resetRateLimitsForTest();
  const result = await checkDistributedRateLimit(
    {
      rpc: () => Promise.resolve({ data: null, error: { message: "missing" } }),
    },
    "ai",
    "user-1",
    {
      limit: 3,
      windowMs: 60_000,
      supabaseUrl: "http://127.0.0.1:54321",
    },
  );
  assertEquals(result.allowed, true);
  assertEquals(result.degraded, true);
});
