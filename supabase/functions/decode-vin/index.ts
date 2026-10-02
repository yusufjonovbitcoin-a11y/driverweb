import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";
import { checkDistributedRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve((request) => withCors(request, async () => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "VIN service is unavailable" }, 503);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
  const { data: profile } = await caller.from("profiles")
    .select("role,status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profile?.role !== "company_admin" || profile.status !== "active") {
    return json({ error: "Company admin permission required" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const vin = String(payload.vin ?? "").trim().toUpperCase();
  if (!vinPattern.test(vin)) return json({ error: "Invalid VIN" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const limit = await checkDistributedRateLimit(admin, "decode-vin", authData.user.id, {
    limit: 30,
    windowMs: 5 * 60_000,
    supabaseUrl,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return json({ error: "VIN decoder is unavailable" }, 502);
    const result = await response.json();
    const row = result?.Results?.[0];
    if (!row) return json({ error: "VIN decoder returned no result" }, 502);
    return json({
      Results: [{
        VIN: row.VIN,
        ErrorCode: row.ErrorCode,
        Make: row.Make,
        Model: row.Model,
        ModelYear: row.ModelYear,
        FuelTypePrimary: row.FuelTypePrimary,
        ElectrificationLevel: row.ElectrificationLevel,
      }],
    });
  } catch {
    return json({ error: "VIN decoder is unavailable" }, 502);
  }
}));
