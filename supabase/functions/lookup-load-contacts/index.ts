import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type StopRow = {
  id: string;
  type: "pickup" | "delivery";
  facility_name: string | null;
  address_line: string;
  city: string;
  region: string;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_source: string | null;
  contact_place_id: string | null;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
};

type RouteContact = {
  role: "pickup" | "delivery" | "dispatcher" | "broker";
  status: "found" | "not_found" | "provider_error";
  name: string;
  phone: string | null;
  source:
    | "broker_document"
    | "dispatcher"
    | "manual"
    | "google_places"
    | "unavailable";
  confidence: number | null;
  googleMapsUri?: string | null;
};

type StopContactResult = {
  contact: RouteContact;
  placeId: string | null | undefined;
  providerError?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function similarity(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function streetNumber(value: string | null | undefined) {
  return normalize(value).match(/\b\d+[a-z]?\b/)?.[0] ?? null;
}

function placeConfidence(stop: StopRow, place: GooglePlace) {
  const facility = stop.facility_name ?? "";
  const address = [stop.address_line, stop.city, stop.region, stop.postal_code]
    .filter(Boolean)
    .join(", ");
  const placeAddress = place.formattedAddress ?? "";
  let score = similarity(facility, place.displayName?.text) * 0.35;
  score += similarity(address, placeAddress) * 0.45;

  const normalizedAddress = normalize(placeAddress);
  if (stop.city && normalizedAddress.includes(normalize(stop.city))) {
    score += 0.08;
  }
  if (stop.region && normalizedAddress.includes(normalize(stop.region))) {
    score += 0.05;
  }
  if (
    stop.postal_code && normalizedAddress.includes(normalize(stop.postal_code))
  ) score += 0.07;

  const expectedStreet = streetNumber(stop.address_line);
  const actualStreet = streetNumber(placeAddress);
  if (expectedStreet && actualStreet) {
    score += expectedStreet === actualStreet ? 0.15 : -0.4;
  }
  return Math.max(0, Math.min(1, score));
}

function phoneOf(place: GooglePlace) {
  return place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null;
}

async function googleRequest(url: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": init?.method === "POST"
        ? "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri"
        : "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,googleMapsUri",
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message ??
      `Google Places returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

async function findStopContact(
  stop: StopRow,
  apiKey: string,
): Promise<StopContactResult> {
  if (stop.contact_phone) {
    const source = stop.contact_source === "broker_document"
      ? "broker_document"
      : stop.contact_source === "dispatcher"
      ? "dispatcher"
      : "manual";
    return {
      contact: {
        role: stop.type,
        status: "found",
        name: stop.contact_name ?? stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone: stop.contact_phone,
        source,
        confidence: 1,
      } satisfies RouteContact,
      placeId: stop.contact_place_id,
    };
  }

  try {
    let place: GooglePlace | null = null;
    let confidence = 1;
    if (stop.contact_place_id) {
      place = await googleRequest(
        `https://places.googleapis.com/v1/places/${
          encodeURIComponent(stop.contact_place_id)
        }`,
        apiKey,
      );
    } else {
      const query = [
        stop.facility_name,
        stop.address_line,
        stop.city,
        stop.region,
        stop.postal_code,
      ].filter(Boolean).join(", ");
      const payload = await googleRequest(
        "https://places.googleapis.com/v1/places:searchText",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            textQuery: query,
            maxResultCount: 5,
            regionCode: "US",
          }),
        },
      );
      const candidates = (payload.places ?? []) as GooglePlace[];
      const ranked = candidates
        .filter((candidate) => candidate.id && phoneOf(candidate))
        .map((candidate) => ({
          candidate,
          score: placeConfidence(stop, candidate),
        }))
        .sort((a, b) => b.score - a.score);
      if (!ranked.length || ranked[0].score < 0.72) {
        return {
          contact: {
            role: stop.type,
            status: "not_found",
            name: stop.facility_name ??
              (stop.type === "pickup" ? "Shipper" : "Receiver"),
            phone: null,
            source: "unavailable",
            confidence: ranked[0]?.score ?? null,
          } satisfies RouteContact,
          placeId: null,
        };
      }
      place = ranked[0].candidate;
      confidence = ranked[0].score;
    }

    const phone = place ? phoneOf(place) : null;
    if (!place || !phone) {
      return {
        contact: {
          role: stop.type,
          status: "not_found",
          name: stop.facility_name ??
            (stop.type === "pickup" ? "Shipper" : "Receiver"),
          phone: null,
          source: "unavailable",
          confidence: null,
        } satisfies RouteContact,
        placeId: place?.id ?? null,
      };
    }

    return {
      contact: {
        role: stop.type,
        status: "found",
        name: place.displayName?.text ?? stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone,
        source: "google_places",
        confidence,
        googleMapsUri: place.googleMapsUri ?? null,
      } satisfies RouteContact,
      placeId: place.id ?? stop.contact_place_id,
    };
  } catch (error) {
    return {
      contact: {
        role: stop.type,
        status: "provider_error",
        name: stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone: null,
        source: "unavailable",
        confidence: null,
      } satisfies RouteContact,
      placeId: null,
      providerError: error instanceof Error
        ? error.message
        : "Google Places is unavailable",
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googlePlacesKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey || !googlePlacesKey) {
    return json({ error: "Function environment is incomplete" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await callerClient.auth
    .getUser();
  if (authError || !authData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const loadId = String(payload.loadId ?? "").trim();
  if (!loadId) return json({ error: "loadId is required" }, 400);

  // This RLS-scoped read is the authorization check for dispatcher and driver callers.
  const { data: visibleLoad } = await callerClient
    .from("loads")
    .select("id")
    .eq("id", loadId)
    .maybeSingle();
  if (!visibleLoad) return json({ error: "Load not found" }, 404);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: load, error: loadError }, { data: stops, error: stopsError }] =
    await Promise.all([
      adminClient
        .from("loads")
        .select(
          "id,company_id,owner_dispatcher_id,broker_name,broker_contact_name,broker_phone",
        )
        .eq("id", loadId)
        .single(),
      adminClient
        .from("load_stops")
        .select(
          "id,type,facility_name,address_line,city,region,postal_code,contact_name,contact_phone,contact_source,contact_place_id",
        )
        .eq("load_id", loadId)
        .order("sequence"),
    ]);
  if (loadError || stopsError || !load) {
    return json({ error: "Could not load route contacts" }, 500);
  }

  const { data: dispatcher } = await adminClient
    .from("profiles")
    .select("full_name,phone")
    .eq("id", load.owner_dispatcher_id)
    .maybeSingle();

  const stopResults = await Promise.all(
    ((stops ?? []) as StopRow[]).map((stop) =>
      findStopContact(stop, googlePlacesKey)
    ),
  );
  await Promise.all(
    stopResults.map((result, index) => {
      const stop = (stops ?? [])[index] as StopRow;
      if (!result.placeId || stop.contact_place_id) return Promise.resolve();
      return adminClient
        .from("load_stops")
        .update({ contact_place_id: result.placeId })
        .eq("id", stop.id)
        .is("contact_place_id", null);
    }),
  );

  const contacts: RouteContact[] = [
    ...stopResults.map((result) => result.contact),
    {
      role: "dispatcher",
      status: dispatcher?.phone ? "found" : "not_found",
      name: dispatcher?.full_name ?? "Dispatcher",
      phone: dispatcher?.phone ?? null,
      source: "dispatcher",
      confidence: dispatcher?.phone ? 1 : null,
    } satisfies RouteContact,
    {
      role: "broker",
      status: load.broker_phone ? "found" : "not_found",
      name: load.broker_contact_name ?? load.broker_name ?? "Broker",
      phone: load.broker_phone ?? null,
      source: load.broker_phone ? "broker_document" : "unavailable",
      confidence: load.broker_phone ? 1 : null,
    } satisfies RouteContact,
  ];
  const providerError = stopResults.find((result) =>
    result.providerError
  )?.providerError ?? null;
  return json({ contacts, providerError });
});
