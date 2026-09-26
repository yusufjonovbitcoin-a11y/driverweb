import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";
import {
  deleteCloudinaryMedia,
  MediaCleanupError,
  parseMediaCleanupPayload,
} from "../_shared/media-cleanup.ts";
import { runPushDeliveryBatch } from "../_shared/push-delivery-runner.ts";
import {
  checkDistributedRateLimit,
  rateLimitResponse,
} from "../_shared/rate-limit.ts";
import { secureEqual } from "../_shared/secure-equal.ts";

type MediaDeleteJob = {
  id: string;
  company_id: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Media cleanup failed";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new MediaCleanupError("Provider request timed out", true)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

Deno.serve((request) =>
  withCors(request, async () => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const startedAt = Date.now();
    const deadlineAt = startedAt + 45_000;
    const expectedToken = Deno.env.get("MEDIA_CLEANUP_WORKER_TOKEN")?.trim() ??
      "";
    const suppliedToken = request.headers.get("X-Worker-Token") ?? "";
    if (!expectedToken) {
      return json({ error: "Function environment is incomplete" }, 500);
    }
    if (!secureEqual(suppliedToken, expectedToken)) {
      return json({ error: "Worker authentication required" }, 401);
    }

    let supabaseUrl: string;
    let serviceRoleKey: string;
    try {
      supabaseUrl = env("SUPABASE_URL");
      serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    } catch {
      return json({ error: "Function environment is incomplete" }, 500);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const workerId = (Deno.env.get("MEDIA_CLEANUP_WORKER_ID") ??
      "edge-media-cleanup-worker").slice(0, 100);
    const rateLimit = await checkDistributedRateLimit(
      admin,
      "process-media-deletions",
      workerId,
      { limit: 120, windowMs: 60_000, supabaseUrl },
    );
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const input = await request.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(input?.batchSize) || 3, 1), 9);
    const [expiredUploads, staleJobs, expiredRateLimits] = await Promise.all([
      admin.rpc("cleanup_expired_document_uploads", { batch_size: 100 }),
      admin.rpc("requeue_stale_jobs", { stale_after: "15 minutes" }),
      admin.rpc("cleanup_edge_rate_limits", {
        retain_for: "2 days",
        batch_size: 1000,
      }),
    ]);
    if (expiredUploads.error || staleJobs.error || expiredRateLimits.error) {
      return json({ error: "Media cleanup maintenance failed" }, 503);
    }
    const maintenance = {
      expiredUploads: Number(expiredUploads.data) || 0,
      staleJobs: Number(staleJobs.data) || 0,
      expiredRateLimits: Number(expiredRateLimits.data) || 0,
    };
    const { data, error: claimError } = await admin.rpc("claim_jobs", {
      worker_id: workerId,
      job_types: ["provider.media_delete"],
      batch_size: batchSize,
    });
    if (claimError) {
      return json({ error: "Media cleanup jobs could not be claimed" }, 503);
    }
    const jobs = (Array.isArray(data) ? data : []) as MediaDeleteJob[];
    if (!jobs.length) {
      return json({
        claimed: 0,
        completed: 0,
        failed: 0,
        transitionFailures: 0,
        deadlineReached: false,
        maintenance,
      });
    }

    let completed = 0;
    let failed = 0;
    let transitionFailures = 0;

    const execution = await runPushDeliveryBatch(jobs, {
      concurrency: 3,
      deadlineAt,
      process: async (job) => {
        try {
          const payload = parseMediaCleanupPayload(job.payload);
          if (payload.provider === "cloudinary") {
            await deleteCloudinaryMedia(payload, {
              cloudName: env("CLOUDINARY_CLOUD_NAME"),
              apiKey: env("CLOUDINARY_API_KEY"),
              apiSecret: env("CLOUDINARY_API_SECRET"),
            });
            const assetId = payload.mediaAssetId ??
              (payload.mediaRef?.startsWith("cloudinary:")
                ? payload.mediaRef.slice("cloudinary:".length)
                : "");
            if (assetId) {
              const { error } = await admin.from("media_assets")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", assetId)
                .eq("company_id", job.company_id);
              if (error) {
                throw new MediaCleanupError(
                  "Cloudinary deletion could not be recorded",
                  true,
                );
              }
            }
          } else {
            const { error } = await withTimeout(
              admin.storage.from(payload.bucket!).remove([
                payload.storagePath!,
              ]),
              10_000,
            );
            if (error) throw new MediaCleanupError(error.message, true);
          }

          const { error: completeError } = await admin.rpc("complete_job", {
            job_id: job.id,
            worker_id: workerId,
          });
          if (completeError) {
            transitionFailures += 1;
            return false;
          }
          completed += 1;
          return true;
        } catch (error) {
          const retryable = !(error instanceof MediaCleanupError) ||
            error.retryable;
          const transition = retryable
            ? admin.rpc("fail_job", {
              job_id: job.id,
              worker_id: workerId,
              error_message: safeError(error),
              retry_after: "1 minute",
            })
            : admin.rpc("dead_letter_job", {
              job_id: job.id,
              worker_id: workerId,
              error_message: safeError(error),
            });
          const { error: failError } = await transition;
          if (failError) transitionFailures += 1;
          else failed += 1;
          return true;
        }
      },
    });

    for (const outcome of execution.processed) {
      if (!outcome.error) continue;
      const { error } = await admin.rpc("fail_job", {
        job_id: outcome.item.id,
        worker_id: workerId,
        error_message: safeError(outcome.error),
        retry_after: "1 minute",
      });
      if (error) transitionFailures += 1;
      else failed += 1;
    }
    for (const job of execution.unprocessed) {
      const { error } = await admin.rpc("fail_job", {
        job_id: job.id,
        worker_id: workerId,
        error_message: "Worker deadline reached before cleanup",
        retry_after: "15 seconds",
      });
      if (error) transitionFailures += 1;
      else failed += 1;
    }

    const response = {
      claimed: jobs.length,
      completed,
      failed,
      transitionFailures,
      deadlineReached: execution.deadlineReached,
      maxConcurrency: execution.maxObservedConcurrency,
      durationMs: Date.now() - startedAt,
      maintenance,
    };
    return json(response, transitionFailures > 0 ? 503 : 200);
  })
);
