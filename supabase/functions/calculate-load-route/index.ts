import { withCors } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkDistributedRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { previewLoadRoute } from '../_shared/google-load-route.ts';

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve((request) => withCors(request, async () => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    return json({ error: "Route service environment is incomplete" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await callerClient.from("profiles")
    .select("role,company_id")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!callerProfile || !["company_admin", "dispatcher"].includes(callerProfile.role)) {
    return json({ error: "Dispatcher permission required" }, 403);
  }
  const limit = await checkDistributedRateLimit(admin, "calculate-load-route", authData.user.id, {
    limit: 60,
    windowMs: 5 * 60_000,
    supabaseUrl,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const loadId = String(payload.loadId ?? "").trim();
  const preview = payload.preview === true;
  const driverIds = Array.isArray(payload.driverIds)
    ? [...new Set(payload.driverIds.map((value) => String(value)).filter(Boolean))]
    : [];
  if (!loadId) return json({ error: "loadId is required" }, 400);
  if ((!preview && !driverIds.length) || driverIds.length > 25) {
    return json({ error: "1 tadan 25 tagacha haydovchini tanlang" }, 400);
  }

  // RLS is the authorization boundary before service-role reads.
  const { data: visibleLoad } = await callerClient
    .from("loads")
    .select("id,status,driver_brief")
    .eq("id", loadId)
    .in("status", preview ? ["draft", "review", "ready_for_offer", "offered", "assigned", "in_progress", "completed"] : ["ready_for_offer", "offered"])
    .maybeSingle();
  if (!visibleLoad) return json({ error: "Taklif uchun ochiq yuk topilmadi" }, 404);
  const { data: visibleDrivers, error: driverError } = await callerClient
    .from("member_directory")
    .select("id")
    .eq("role", "driver")
    .in("id", driverIds);
  if (driverError || (visibleDrivers?.length ?? 0) !== driverIds.length) {
    return json({ error: "Tanlangan haydovchilardan biri sizga ochiq emas" }, 403);
  }

  const adminClient = admin;
  const [{ data: stops, error: stopsError }, { data: presence, error: presenceError }] =
    await Promise.all([
      adminClient.from("load_stops")
        .select("id,type,address_line,city,region,postal_code,latitude,longitude,contact_place_id")
        .eq("load_id", loadId)
        .order("sequence"),
      adminClient.from("driver_presence")
        .select("driver_id,latitude,longitude,is_online,last_seen_at")
        .in("driver_id", driverIds),
    ]);
  if (stopsError || presenceError) return json({ error: "Marshrut ma’lumotlarini olib bo‘lmadi" }, 500);
  const pickup = (stops ?? []).find((stop) => stop.type === "pickup");
  const delivery = (stops ?? []).find((stop) => stop.type === "delivery");
  if (!pickup || !delivery) return json({ error: "Pickup yoki delivery manzili topilmadi" }, 422);

  if (preview) {
    const blocked = visibleLoad.driver_brief?.blockingFields ?? [];
    if (blocked.some((key: string) => /^(pickup|delivery)\.(addressLine|city|region|postalCode)$/.test(key))) {
      return json({ error: 'Document address needs review' }, 422);
    }
    try {
      return json(await previewLoadRoute(stops ?? [], presence ?? [], driverIds, googleKey ?? '', fetch, Date.now(), Deno.env.get('MAPBOX_ACCESS_TOKEN') ?? '', 'mapbox'));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Route unavailable' }, 422);
    }
  }

  try {
    const result = await previewLoadRoute(stops ?? [], presence ?? [], driverIds, googleKey ?? '', fetch,
      Date.now(), Deno.env.get('MAPBOX_ACCESS_TOKEN') ?? '', 'mapbox');
    const { error: saveError } = await callerClient.rpc('apply_route_estimate', {
      load_id: loadId,
      calculated_distance_miles: result.loadedMiles,
      calculated_duration_seconds: result.durationSeconds,
      calculated_provider: result.provider,
    });
    if (saveError) throw new Error(saveError.message);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Mapbox route unavailable' }, 422);
  }
}));
