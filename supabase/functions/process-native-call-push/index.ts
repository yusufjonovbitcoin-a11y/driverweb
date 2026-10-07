import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchFirebaseAccessToken,
  parseFirebaseServiceAccount,
  sendCallFcmMessage,
} from "../_shared/fcm.ts";
import {
  apnsConfiguration,
  apnsProviderToken,
  sendVoipPush,
} from "../_shared/apns-voip.ts";
import {
  createCallCapability,
  validCallId,
} from "../_shared/native-call-token.ts";
import { secureEqual } from "../_shared/secure-equal.ts";
import { checkDistributedRateLimit } from "../_shared/rate-limit.ts";
import { runPushDeliveryBatch } from "../_shared/push-delivery-runner.ts";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const accepted = () => json({ accepted: true }, 202);
Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: "Invalid wake" }, 400);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid wake" }, 400);
  }
  const supplied = request.headers.get("X-Worker-Token") ?? "";
  const trusted = ["PUSH_WORKER_TOKEN", "PUSH_CRON_TOKEN"].some((name) => {
    const expected = Deno.env.get(name) ?? "";
    return expected.length > 0 && secureEqual(supplied, expected);
  });
  if (!trusted && !validCallId(input?.call_id)) {
    return json({ error: "Valid call wake required" }, 400);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    return trusted ? json({ error: "Worker unavailable" }, 503) : accepted();
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (!trusted) {
    // No supplied identity becomes authority; even a valid wake only drains
    // existing server-created eligible deliveries. Never reveal whether it exists.
    const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(
      ",",
    )[0].trim().slice(0, 100);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)),
      ),
    ).map((v) => v.toString(16).padStart(2, "0")).join("");
    for (
      const [scope, subject, limit, windowMs] of [
        ["native-call-wake-ip", hash, 120, 60_000],
        ["native-call-wake", input.call_id, 4, 5000],
      ] as const
    ) {
      const quota = await checkDistributedRateLimit(admin, scope, subject, {
        limit,
        windowMs,
        supabaseUrl: url,
      });
      if (!quota.allowed) return accepted();
    }
  }
  const workerId = `native-${crypto.randomUUID()}`;
  const deadlineAt = Date.now() + 8500;
  const { data, error } = await admin.rpc("claim_native_call_deliveries", {
    p_worker_id: workerId,
    p_call_id: validCallId(input?.call_id) ? input.call_id : null,
    p_limit: 40,
  });
  if (error) {
    return trusted
      ? json({ error: "Call outbox unavailable" }, 503)
      : accepted();
  }
  const deliveries = Array.isArray(data) ? data : [];
  if (!deliveries.length) {
    return trusted ? json({ claimed: 0, completed: 0 }) : accepted();
  }
  // Crypto/provider credentials are touched only after work has been claimed.
  const secret = Deno.env.get("NATIVE_CALL_ACTION_SECRET") ?? "";
  const apns = apnsConfiguration({
    keyId: Deno.env.get("APNS_KEY_ID"),
    teamId: Deno.env.get("APNS_TEAM_ID"),
    privateKey: Deno.env.get("APNS_PRIVATE_KEY"),
    bundleId: Deno.env.get("APNS_BUNDLE_ID"),
  });
  let firebase: ReturnType<typeof parseFirebaseServiceAccount> | null = null;
  let firebaseToken: Promise<string> | null = null;
  let appleToken: Promise<string> | null = null;
  let completed = 0, failed = 0, cancelled = 0, transitionFailures = 0;
  const finish = async (
    id: string,
    outcome: string,
    error: string | null = null,
  ) => {
    const result = await admin.rpc("finish_native_call_delivery", {
      p_delivery_id: id,
      p_worker_id: workerId,
      p_outcome: outcome,
      p_error: error,
    });
    if (result.error || (result.data !== true && outcome !== "cancelled")) {
      transitionFailures++;
    } else if (outcome === "sent") completed++;
    else if (outcome === "retry") failed++;
    else cancelled++;
  };
  const process = async (item: { delivery_id: string }) => {
    try {
      const { data: initial, error: lookupError } = await admin.rpc(
        "get_native_call_delivery",
        { p_delivery_id: item.delivery_id, p_worker_id: workerId },
      );
      if (lookupError) {
        await finish(item.delivery_id, "retry", "Eligibility unavailable");
        return;
      }
      if (!initial) {
        await finish(item.delivery_id, "cancelled", "Call no longer eligible");
        return;
      }
      // Provider authentication may involve a network request. Acquire it before
      // the final eligibility read so a block/end during OAuth cannot send an
      // old invitation after its cancellation has already been processed.
      let authorization: string;
      if (initial.transport === "apns_voip") {
        if (!apns || secret.length < 32) {
          await finish(
            item.delivery_id,
            "fallback",
            "VoIP configuration unavailable",
          );
          return;
        }
        appleToken ??= apnsProviderToken(apns);
        authorization = await appleToken;
      } else {
        firebase ??= parseFirebaseServiceAccount(
          Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "",
        );
        firebaseToken ??= fetchFirebaseAccessToken(firebase);
        authorization = await firebaseToken;
      }
      const { data: current, error: finalError } = await admin.rpc(
        "get_native_call_delivery",
        {
          p_delivery_id: item.delivery_id,
          p_worker_id: workerId,
        },
      );
      if (finalError || !current) {
        await finish(
          item.delivery_id,
          finalError ? "retry" : "cancelled",
          finalError ? "Eligibility unavailable" : "Call no longer eligible",
        );
        return;
      }
      const invite = current.event === "incoming_call";
      // A linked iOS FCM token is the fallback, never a second invitation after APNs succeeds.
      if (
        invite && current.transport === "fcm" && current.platform === "ios" &&
        current.voip_delivery_status === "sent"
      ) {
        await finish(
          item.delivery_id,
          "cancelled",
          "VoIP invitation delivered",
        );
        return;
      }
      if (
        invite && current.transport === "fcm" && current.platform === "ios" &&
        ["pending", "processing"].includes(current.voip_delivery_status)
      ) {
        await finish(item.delivery_id, "retry", "Awaiting VoIP delivery");
        return;
      }
      const payload: Record<string, string> = {
        event: current.event,
        call_id: current.call_id,
        conversation_id: current.conversation_id,
        recipient_id: current.recipient_id,
        device_id: current.action_device_id,
        expires_at: current.expires_at,
        call_status: current.call_status,
        accepted_device_id: current.accepted_device_id ?? "",
      };
      if (invite) {
        payload.caller_name = current.caller_name || "T Fleets";
        payload.call_kind = current.call_kind;
        if (secret.length >= 32) {
          payload.action_token = await createCallCapability(
            secret,
            current.call_id,
            current.recipient_id,
            current.action_device_id,
            current.started_at,
          );
          payload.action_url = `${url}/functions/v1/native-call-action`;
        }
      }
      let result;
      if (current.transport === "apns_voip") {
        if (!apns || !payload.action_token) {
          await finish(
            item.delivery_id,
            "fallback",
            "VoIP configuration unavailable",
          );
          return;
        }
        result = await sendVoipPush(
          apns,
          authorization,
          current.token,
          current.environment,
          current.bundle_id,
          payload,
        );
      } else {
        const dataOnly = !invite ||
          (current.platform === "android" && current.native_calls &&
            !!payload.action_token);
        const alert = dataOnly ? null : {
          title: "Incoming call",
          body: `${payload.caller_name} is calling`,
        };
        result = await sendCallFcmMessage(
          firebase!,
          authorization,
          current.token,
          payload,
          alert,
        );
      }
      await finish(
        item.delivery_id,
        result.ok
          ? "sent"
          : result.invalidToken
          ? "invalid_token"
          : result.retryable
          ? "retry"
          : "fallback",
        result.error,
      );
    } catch {
      await finish(
        item.delivery_id,
        "retry",
        "Native push transport unavailable",
      );
    }
  };
  // APNs first makes linked FCM fallback deterministic within this drain. Separate
  // workers still respect leases and re-read the APNs outcome before FCM delivery.
  for (const transport of ["apns_voip", "fcm"]) {
    const group = [];
    for (const item of deliveries) {
      // The claim includes transport only as routing metadata, never credentials.
      if (item.transport === transport) group.push(item);
    }
    const execution = await runPushDeliveryBatch(group, {
      concurrency: 8,
      deadlineAt,
      process,
    });
    transitionFailures += execution.processed.filter((item) =>
      item.error !== undefined
    ).length;
    for (const item of execution.unprocessed) {
      await finish(item.delivery_id, "retry", "Worker deadline");
    }
  }
  return trusted
    ? json({
      claimed: deliveries.length,
      completed,
      failed,
      cancelled,
      transitionFailures,
    }, transitionFailures ? 503 : 200)
    : accepted();
});
