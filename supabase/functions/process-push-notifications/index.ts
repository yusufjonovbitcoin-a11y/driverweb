import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";
import {
  fetchFirebaseAccessToken,
  parseFirebaseServiceAccount,
  sendFcmMessage,
} from "../_shared/fcm.ts";
import {
  checkDistributedRateLimit,
  rateLimitResponse,
} from "../_shared/rate-limit.ts";
import { runPushDeliveryBatch } from "../_shared/push-delivery-runner.ts";
import { secureEqual } from "../_shared/secure-equal.ts";

type PushDelivery = {
  notification_id: string;
  device_id: string;
  company_id: string;
  recipient_id: string;
  platform: string;
  push_token: string;
  title: string;
  body: string;
  notification_type: string;
  entity_type: string | null;
  entity_id: string | null;
  attempt_count: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Push delivery failed";
}

Deno.serve((request) =>
  withCors(request, async () => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const startedAt = Date.now();
    const deadlineAt = startedAt + 45_000;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const expectedWorkerToken = Deno.env.get("PUSH_WORKER_TOKEN") ?? "";
    const suppliedWorkerToken = request.headers.get("X-Worker-Token") ?? "";
    if (!supabaseUrl || !serviceRoleKey || !expectedWorkerToken) {
      return json({ error: "Function environment is incomplete" }, 500);
    }
    if (!secureEqual(suppliedWorkerToken, expectedWorkerToken)) {
      return json({ error: "Worker authentication required" }, 401);
    }

    let serviceAccount;
    try {
      serviceAccount = parseFirebaseServiceAccount(
        Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "",
      );
    } catch {
      return json({ error: "Firebase credentials are unavailable" }, 503);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const workerId = (Deno.env.get("PUSH_WORKER_ID") ?? "edge-push-worker")
      .slice(0, 100);
    const limit = await checkDistributedRateLimit(
      admin,
      "process-push-notifications",
      workerId,
      { limit: 120, windowMs: 60_000, supabaseUrl },
    );
    if (!limit.allowed) return rateLimitResponse(limit);

    const input = await request.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(input?.batchSize) || 3, 1), 9);
    const { data, error: claimError } = await admin.rpc(
      "claim_push_deliveries",
      { worker_id: workerId, batch_size: batchSize },
    );
    if (claimError) {
      return json({ error: "Push deliveries could not be claimed" }, 503);
    }
    const deliveries = (Array.isArray(data) ? data : []) as PushDelivery[];
    if (!deliveries.length) {
      return json({
        claimed: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        transitionFailures: 0,
        deadlineReached: false,
      });
    }

    let accessToken: string;
    try {
      accessToken = await fetchFirebaseAccessToken(serviceAccount);
    } catch (error) {
      let transitionFailures = 0;
      for (const delivery of deliveries) {
        const { data: released, error: releaseError } = await admin.rpc(
          "fail_push_delivery",
          {
            notification_id: delivery.notification_id,
            device_id: delivery.device_id,
            worker_id: workerId,
            error_message: safeError(error),
            retry_after: "1 minute",
            retryable: true,
          },
        );
        if (releaseError || released !== true) transitionFailures += 1;
      }
      return json({
        error: "Firebase authentication failed",
        claimed: deliveries.length,
        transitionFailures,
      }, 503);
    }

    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let invalidTokensRemoved = 0;
    let transitionFailures = 0;

    const transitionFailure = () => {
      transitionFailures += 1;
      return false;
    };

    const execution = await runPushDeliveryBatch(deliveries, {
      concurrency: 3,
      deadlineAt,
      process: async (delivery) => {
        try {
          const result = await sendFcmMessage(
            serviceAccount,
            accessToken,
            delivery.push_token,
            { title: delivery.title, body: delivery.body },
            {
              notificationId: delivery.notification_id,
              type: delivery.notification_type,
              entityType: delivery.entity_type ?? "",
              entityId: delivery.entity_id ?? "",
            },
          );

          if (result.ok) {
            const { data: transitioned, error } = await admin.rpc(
              "complete_push_delivery",
              {
                notification_id: delivery.notification_id,
                device_id: delivery.device_id,
                worker_id: workerId,
                provider_message_id: result.providerMessageId,
              },
            );
            if (error || transitioned !== true) return transitionFailure();
            completed += 1;
            return true;
          }

          if (result.invalidToken) {
            const { error } = await admin.from("push_devices").delete()
              .eq("id", delivery.device_id)
              .eq("user_id", delivery.recipient_id)
              .eq("company_id", delivery.company_id);
            if (error) return transitionFailure();
            invalidTokensRemoved += 1;
            cancelled += 1;
            return true;
          }

          const { data: transitioned, error } = await admin.rpc(
            "fail_push_delivery",
            {
              notification_id: delivery.notification_id,
              device_id: delivery.device_id,
              worker_id: workerId,
              error_message: result.error ?? "FCM delivery failed",
              retry_after: "1 minute",
              retryable: result.retryable,
            },
          );
          if (error || transitioned !== true) return transitionFailure();
          failed += 1;
          if (!result.retryable) cancelled += 1;
          return true;
        } catch (error) {
          const { data: transitioned, error: transitionError } = await admin.rpc(
            "fail_push_delivery",
            {
              notification_id: delivery.notification_id,
              device_id: delivery.device_id,
              worker_id: workerId,
              error_message: safeError(error),
              retry_after: "1 minute",
              retryable: true,
            },
          );
          if (transitionError || transitioned !== true) {
            return transitionFailure();
          }
          failed += 1;
          return true;
        }
      },
    });

    for (const outcome of execution.processed) {
      if (!outcome.error) continue;
      const delivery = outcome.item;
      const { data: transitioned, error } = await admin.rpc(
        "fail_push_delivery",
        {
          notification_id: delivery.notification_id,
          device_id: delivery.device_id,
          worker_id: workerId,
          error_message: safeError(outcome.error),
          retry_after: "1 minute",
          retryable: true,
        },
      );
      if (error || transitioned !== true) transitionFailures += 1;
      else failed += 1;
    }

    for (const delivery of execution.unprocessed) {
      const { data: transitioned, error } = await admin.rpc(
        "fail_push_delivery",
        {
          notification_id: delivery.notification_id,
          device_id: delivery.device_id,
          worker_id: workerId,
          error_message: "Worker deadline reached before delivery",
          retry_after: "15 seconds",
          retryable: true,
        },
      );
      if (error || transitioned !== true) transitionFailures += 1;
      else failed += 1;
    }

    const response = {
      claimed: deliveries.length,
      completed,
      failed,
      cancelled,
      invalidTokensRemoved,
      transitionFailures,
      deadlineReached: execution.deadlineReached,
      maxConcurrency: execution.maxObservedConcurrency,
      durationMs: Date.now() - startedAt,
    };
    return json(response, transitionFailures > 0 ? 503 : 200);
  })
);
