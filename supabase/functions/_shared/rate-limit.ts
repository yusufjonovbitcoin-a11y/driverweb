type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: number;
};

type RpcError = { message?: string } | null;
type RateLimitRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

type DistributedRateLimitOptions = RateLimitOptions & {
  supabaseUrl: string;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  degraded?: boolean;
  unavailable?: boolean;
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let checks = 0;

export function checkRateLimit(
  scope: string,
  actor: string,
  options: RateLimitOptions,
) {
  const now = options.now ?? Date.now();
  const key = `${scope}:${actor}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  checks += 1;
  if (checks % 500 === 0) {
    for (const [bucketKey, candidate] of buckets) {
      if (candidate.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(options.limit - bucket.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1),
  };
}

function isLocalSupabaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export async function checkDistributedRateLimit(
  admin: RateLimitRpcClient,
  scope: string,
  actor: string,
  options: DistributedRateLimitOptions,
): Promise<RateLimitResult> {
  const local = checkRateLimit(scope, actor, options);
  if (!local.allowed) return local;

  const { data, error } = await admin.rpc("consume_edge_rate_limit", {
    scope,
    actor,
    limit_count: options.limit,
    window_seconds: Math.max(1, Math.ceil(options.windowMs / 1000)),
  });
  if (error || typeof data !== "boolean") {
    if (isLocalSupabaseUrl(options.supabaseUrl)) {
      return { ...local, degraded: true };
    }
    return {
      ...local,
      allowed: false,
      unavailable: true,
      retryAfterSeconds: 30,
    };
  }
  return { ...local, allowed: data };
}

export function rateLimitResponse(
  result: ReturnType<typeof checkRateLimit> & { unavailable?: boolean },
) {
  const unavailable = result.unavailable === true;
  return new Response(
    JSON.stringify({
      error: unavailable
        ? "Rate limit service is temporarily unavailable."
        : "Too many requests. Please retry later.",
    }),
    {
      status: unavailable ? 503 : 429,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

export function resetRateLimitsForTest() {
  buckets.clear();
  checks = 0;
}
