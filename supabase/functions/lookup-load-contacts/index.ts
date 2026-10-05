import { withCors } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkDistributedRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { findStopContact, type StopRow, type RouteContact } from '../_shared/load-contact-lookup.ts';
import { previewContactStops } from '../_shared/load-preview-contacts.ts';
import { verifyLoadPreviewContactsTicket } from '../_shared/load-preview-ticket.ts';
import { verifyLoadExtraction } from '../_shared/load-extraction-verification.ts';

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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await callerClient.auth
    .getUser();
  if (authError || !authData.user) {
    return json({ error: "Invalid session" }, 401);
  }
  const limit = await checkDistributedRateLimit(admin, "lookup-load-contacts", authData.user.id, {
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
  if (payload.previewTicket) {
    if (loadId) return json({ error: "Use either loadId or previewTicket" }, 400);
    const { data: profile } = await callerClient.from('profiles')
      .select('id,company_id,role,status').eq('id', authData.user.id).maybeSingle();
    if (!profile || profile.status !== 'active' || !profile.company_id
      || !['company_admin', 'dispatcher'].includes(profile.role)) {
      return json({ error: 'Dispatcher permission required' }, 403);
    }
    let previewStops: StopRow[];
    try {
      const candidate = await verifyLoadPreviewContactsTicket(
        payload.previewTicket as { payload: unknown; signature: unknown },
        { actorId: profile.id, companyId: profile.company_id }, serviceRoleKey,
      );
      previewStops = previewContactStops(verifyLoadExtraction(candidate, null, true).safe);
    } catch {
      return json({ error: 'Preview is invalid or expired. Analyze the document again.' }, 400);
    }
    const results = await Promise.all(previewStops.map(stop => findStopContact(stop, googlePlacesKey)));
    // No load, document, file or stop is persisted during a preview lookup.
    return json({ contacts: results.map((result, index) => ({ ...result.contact, sequence: index + 1 })),
      providerError: results.find(result => result.providerError)?.providerError ?? null });
  }
  if (!loadId) return json({ error: "loadId or previewTicket is required" }, 400);

  // This RLS-scoped read is the authorization check for dispatcher and driver callers.
  const { data: visibleLoad } = await callerClient
    .from("loads")
    .select("id")
    .eq("id", loadId)
    .maybeSingle();
  if (!visibleLoad) return json({ error: "Load not found" }, 404);

  const adminClient = admin;
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
    ...stopResults.map((result, index) => ({ ...result.contact, stopId: stops[index].id, sequence: index + 1 })),
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
}));
