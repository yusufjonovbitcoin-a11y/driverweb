import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const metersPerMile = 1609.344;

type Stop = {
  type: "pickup" | "delivery";
  address_line: string;
  city: string;
  region: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_place_id: string | null;
};

type RouteResult = {
  distanceMiles: number;
  durationSeconds: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stopWaypoint(stop: Stop) {
  if (stop.contact_place_id) return { placeId: stop.contact_place_id };
  if (stop.latitude != null && stop.longitude != null) {
    return {
      location: {
        latLng: { latitude: stop.latitude, longitude: stop.longitude },
      },
    };
  }
  return {
    address: [stop.address_line, stop.city, stop.region, stop.postal_code, "USA"]
      .filter(Boolean)
      .join(", "),
  };
}

function durationSeconds(value: unknown) {
  const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.max(0, Math.round(Number(match[1]))) : 0;
}

async function computeRoute(
  apiKey: string,
  origin: Record<string, unknown>,
  destination: Record<string, unknown>,
): Promise<RouteResult> {
  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin,
        destination,
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: false,
        routeModifiers: {
          avoidTolls: false,
          avoidHighways: false,
          avoidFerries: false,
        },
        languageCode: "en-US",
        units: "IMPERIAL",
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Google Routes returned HTTP ${response.status}`,
    );
  }
  const route = payload?.routes?.[0];
  if (!route?.distanceMeters) throw new Error("Google marshrut topa olmadi");
  return {
    distanceMiles: Math.round((route.distanceMeters / metersPerMile) * 100) / 100,
    durationSeconds: durationSeconds(route.duration),
  };
}

Deno.serve(async (request) => {
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
  if (!supabaseUrl || !publicKey || !serviceRoleKey || !googleKey) {
    return json({ error: "Route service environment is incomplete" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
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

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const loadId = String(payload.loadId ?? "").trim();
  const driverIds = Array.isArray(payload.driverIds)
    ? [...new Set(payload.driverIds.map((value) => String(value)).filter(Boolean))]
    : [];
  if (!loadId) return json({ error: "loadId is required" }, 400);
  if (!driverIds.length || driverIds.length > 25) {
    return json({ error: "1 tadan 25 tagacha haydovchini tanlang" }, 400);
  }

  // RLS is the authorization boundary before service-role reads.
  const { data: visibleLoad } = await callerClient
    .from("loads")
    .select("id,status")
    .eq("id", loadId)
    .in("status", ["ready_for_offer", "offered"])
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: stops, error: stopsError }, { data: presence, error: presenceError }] =
    await Promise.all([
      adminClient.from("load_stops")
        .select("type,address_line,city,region,postal_code,latitude,longitude,contact_place_id")
        .eq("load_id", loadId)
        .order("sequence"),
      adminClient.from("driver_presence")
        .select("driver_id,latitude,longitude,is_online,last_seen_at")
        .in("driver_id", driverIds),
    ]);
  if (stopsError || presenceError) return json({ error: "Marshrut ma’lumotlarini olib bo‘lmadi" }, 500);
  const pickup = (stops ?? []).find((stop) => stop.type === "pickup") as Stop | undefined;
  const delivery = (stops ?? []).find((stop) => stop.type === "delivery") as Stop | undefined;
  if (!pickup || !delivery) return json({ error: "Pickup yoki delivery manzili topilmadi" }, 422);

  try {
    const pickupWaypoint = stopWaypoint(pickup);
    const route = await computeRoute(googleKey, pickupWaypoint, stopWaypoint(delivery));
    const { error: saveError } = await callerClient.rpc("apply_route_estimate", {
      load_id: loadId,
      calculated_distance_miles: route.distanceMiles,
      calculated_duration_seconds: route.durationSeconds,
      calculated_provider: "google_routes",
    });
    if (saveError) throw new Error(saveError.message);

    const now = Date.now();
    const presenceByDriver = new Map(
      (presence ?? []).map((row) => [String(row.driver_id), row]),
    );
    const targets = await Promise.all(driverIds.map(async (driverId) => {
      const current = presenceByDriver.get(driverId);
      const isFresh = current?.is_online === true &&
        Date.parse(String(current.last_seen_at)) >= now - 2 * 60 * 1000;
      const hasCurrentLocation = isFresh && current?.latitude != null && current?.longitude != null;
      if (!hasCurrentLocation) {
        return {
          driverId,
          originLatitude: null,
          originLongitude: null,
          deadheadMiles: 0,
          hasCurrentLocation: false,
        };
      }
      try {
        const deadhead = await computeRoute(
          googleKey,
          {
            location: {
              latLng: {
                latitude: Number(current.latitude),
                longitude: Number(current.longitude),
              },
            },
          },
          pickupWaypoint,
        );
        return {
          driverId,
          originLatitude: Number(current.latitude),
          originLongitude: Number(current.longitude),
          deadheadMiles: deadhead.distanceMiles,
          hasCurrentLocation: true,
        };
      } catch {
        return {
          driverId,
          originLatitude: Number(current.latitude),
          originLongitude: Number(current.longitude),
          deadheadMiles: 0,
          hasCurrentLocation: false,
        };
      }
    }));
    return json({
      loadedMiles: route.distanceMiles,
      durationSeconds: route.durationSeconds,
      provider: "google_routes",
      targets,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Google marshrutni hisoblay olmadi",
    }, 422);
  }
});
