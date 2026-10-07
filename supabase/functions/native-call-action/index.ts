import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkDistributedRateLimit } from "../_shared/rate-limit.ts";
import {
  validCallId,
  verifyCallCapability,
} from "../_shared/native-call-token.ts";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: "Invalid native action" }, 400);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid native action" }, 400);
  }
  if (
    !validCallId(input?.call_id) ||
    !["status", "decline"].includes(input?.action)
  ) return json({ error: "Invalid native action" }, 400);
  const secret = Deno.env.get("NATIVE_CALL_ACTION_SECRET") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (secret.length < 32 || !url || !key) {
    return json({ error: "Native actions unavailable" }, 503);
  }
  const capability = await verifyCallCapability(
    secret,
    input.action_token,
    input.call_id,
  );
  if (
    !capability ||
    (input.device_id != null && input.device_id !== capability.device_id)
  ) return json({ error: "Native action expired or invalid" }, 401);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const quota = await checkDistributedRateLimit(
    admin,
    `native-call-${input.action}`,
    `${capability.call_id}:${capability.device_id}`,
    {
      limit: input.action === "status" ? 120 : 20,
      windowMs: 60_000,
      supabaseUrl: url,
    },
  );
  if (!quota.allowed) {
    return json({
      error: quota.unavailable
        ? "Native action unavailable"
        : "Native action rate limited",
    }, quota.unavailable ? 503 : 429);
  }
  const { data, error } = await admin.rpc("native_call_action", {
    p_call_id: capability.call_id,
    p_recipient_id: capability.recipient_id,
    p_device_id: capability.device_id,
    p_action: input.action,
  });
  if (error) return json({ error: "Native action unavailable" }, 503);
  if (!data) return json({ error: "Call unavailable" }, 404);
  return json(data);
});
