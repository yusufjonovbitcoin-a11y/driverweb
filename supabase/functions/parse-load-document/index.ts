import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { uploadPrivateMedia } from "../_shared/cloudinary-media.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const SUPPORTED_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

type StopExtraction = {
  facilityName: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  appointmentFrom: string | null;
  appointmentTo: string | null;
  appointmentTimezone: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

type LoadExtraction = {
  loadNumber: string | null;
  broker: {
    name: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    fax: string | null;
  };
  freightMode: string | null;
  cargoDescription: string | null;
  equipmentType: string | null;
  temperatureFahrenheit: number | null;
  palletCount: number | null;
  caseCount: number | null;
  isHazmat: boolean | null;
  specialInstructions: string | null;
  requirements: string[];
  weightLbs: number | null;
  brokerRate: number | null;
  loadedMiles: number | null;
  pickup: StopExtraction;
  delivery: StopExtraction;
  confidence: number;
  missingFields: string[];
};

const stopSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    facilityName: { type: ["string", "null"] },
    addressLine: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    region: { type: ["string", "null"] },
    postalCode: { type: ["string", "null"] },
    appointmentFrom: { type: ["string", "null"] },
    appointmentTo: { type: ["string", "null"] },
    appointmentTimezone: { type: ["string", "null"] },
    contactName: { type: ["string", "null"] },
    contactPhone: { type: ["string", "null"] },
  },
  required: [
    "facilityName",
    "addressLine",
    "city",
    "region",
    "postalCode",
    "appointmentFrom",
    "appointmentTo",
    "appointmentTimezone",
    "contactName",
    "contactPhone",
  ],
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    loadNumber: { type: ["string", "null"] },
    broker: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        contactName: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        fax: { type: ["string", "null"] },
      },
      required: ["name", "contactName", "phone", "email", "fax"],
    },
    freightMode: { type: ["string", "null"] },
    cargoDescription: { type: ["string", "null"] },
    equipmentType: { type: ["string", "null"] },
    temperatureFahrenheit: { type: ["number", "null"] },
    palletCount: { type: ["integer", "null"] },
    caseCount: { type: ["integer", "null"] },
    isHazmat: { type: ["boolean", "null"] },
    specialInstructions: { type: ["string", "null"] },
    requirements: { type: "array", items: { type: "string" } },
    weightLbs: { type: ["integer", "null"] },
    brokerRate: { type: ["number", "null"] },
    loadedMiles: { type: ["number", "null"] },
    pickup: stopSchema,
    delivery: stopSchema,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingFields: { type: "array", items: { type: "string" } },
  },
  required: [
    "loadNumber",
    "broker",
    "freightMode",
    "cargoDescription",
    "equipmentType",
    "temperatureFahrenheit",
    "palletCount",
    "caseCount",
    "isHazmat",
    "specialInstructions",
    "requirements",
    "weightLbs",
    "brokerRate",
    "loadedMiles",
    "pickup",
    "delivery",
    "confidence",
    "missingFields",
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return cleaned || "document";
}

function hasExpectedExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  return (SUPPORTED_EXTENSIONS[file.type] ?? []).some((extension) =>
    lowerName.endsWith(extension)
  );
}

function hasExpectedSignature(type: string, bytes: Uint8Array) {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (type === "application/pdf") {
    return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d);
  }
  if (type === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (type === "image/png") {
    return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  }
  if (type === "image/gif") {
    const header = new TextDecoder().decode(bytes.subarray(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (type === "image/webp") {
    const riff = new TextDecoder().decode(bytes.subarray(0, 4));
    const webp = new TextDecoder().decode(bytes.subarray(8, 12));
    return riff === "RIFF" && webp === "WEBP";
  }
  return false;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function text(value: unknown, fallback: string | null = null) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function integer(value: unknown) {
  const parsed = Math.round(number(value, 0));
  return parsed > 0 ? parsed : null;
}

const STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  IA: "America/Chicago", ID: "America/Boise", IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis", KS: "America/Chicago",
  KY: "America/New_York", LA: "America/Chicago", MA: "America/New_York",
  MD: "America/New_York", ME: "America/New_York", MI: "America/Detroit",
  MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago",
  MT: "America/Denver", NC: "America/New_York", ND: "America/Chicago",
  NE: "America/Chicago", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NV: "America/Los_Angeles", NY: "America/New_York",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VA: "America/New_York", VT: "America/New_York",
  WA: "America/Los_Angeles", WI: "America/Chicago", WV: "America/New_York",
  WY: "America/Denver",
};

function inferredTimezone(stop: StopExtraction) {
  const supplied = text(stop.appointmentTimezone);
  if (supplied) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: supplied }).format();
      return supplied;
    } catch {
      // Invalid model output falls back to the stop's state.
    }
  }
  return STATE_TIMEZONES[text(stop.region, "")!.toUpperCase()] ?? null;
}

function zonedDateTime(value: unknown, timeZone: string | null) {
  const normalized = text(value);
  if (!normalized) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const absolute = new Date(normalized);
    return Number.isNaN(absolute.getTime()) ? null : absolute.toISOString();
  }
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match || !timeZone) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const desiredUtc = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    Number(second),
  );
  let timestamp = desiredUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    timestamp += desiredUtc - representedUtc;
  }
  const result = new Date(timestamp);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function outputText(payload: Record<string, unknown>) {
  const outputs = Array.isArray(payload.output) ? payload.output : [];
  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const content = Array.isArray((output as { content?: unknown[] }).content)
      ? (output as { content: unknown[] }).content
      : [];
    for (const item of content) {
      if (
        item && typeof item === "object" &&
        (item as { type?: string }).type === "output_text" &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        return (item as { text: string }).text;
      }
      if (
        item && typeof item === "object" &&
        (item as { type?: string }).type === "refusal"
      ) {
        throw new Error("OpenAI hujjatni tahlil qilishni rad etdi.");
      }
    }
  }
  throw new Error("OpenAI hujjatdan natija qaytarmadi.");
}

async function extractLoad(
  file: File,
  bytes: Uint8Array,
  apiKey: string,
  model: string,
): Promise<LoadExtraction> {
  const base64 = toBase64(bytes);
  const documentInput = file.type === "application/pdf"
    ? {
      type: "input_file",
      filename: safeFileName(file.name),
      file_data: `data:application/pdf;base64,${base64}`,
    }
    : {
      type: "input_image",
      image_url: `data:${file.type};base64,${base64}`,
      detail: "high",
    };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions:
        "You extract US trucking load data from broker rate confirmations, driver sheets, BOLs, PODs, and other load documents. Read only facts visible in the supplied file and never invent values. Use null for unknown scalar values and [] for unknown lists. Appointment values must preserve the printed local date and time as YYYY-MM-DDTHH:mm; put a single printed appointment in appointmentFrom and leave appointmentTo null. Use appointmentTo only for a real printed range. Set appointmentTimezone only when the document explicitly prints a valid IANA timezone; otherwise leave it null because the server derives it from the stop state. Normalize US state names to two-letter codes. Keep phone numbers as printed. Capture broker email and fax, mode, temperature, pallet/case counts, hazmat status, every operational requirement, and the full carrier note. A driver/carrier information sheet is valid load source material even when it has no rate. List every important missing or uncertain field in missingFields.",
      input: [{
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text:
              "Extract all visible load facts, contacts, route appointments, pricing, mileage, cargo specifications, temperature, quantities, hazmat status, and carrier requirements. Return the structured extraction.",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "trucking_load_document",
          strict: true,
          schema: extractionSchema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("OpenAI load extraction failed", {
      status: response.status,
      type: payload?.error?.type ?? null,
      code: payload?.error?.code ?? null,
    });
    throw new Error(
      response.status === 429
        ? "AI limiti vaqtincha tugadi. Birozdan keyin qayta urinib ko'ring."
        : "AI hujjatni tahlil qila olmadi. Birozdan keyin qayta urinib ko'ring.",
    );
  }
  return JSON.parse(outputText(payload)) as LoadExtraction;
}

function normalizeStop(stop: StopExtraction) {
  const timeZone = inferredTimezone(stop);
  const printedFrom = text(stop.appointmentFrom);
  const printedTo = text(stop.appointmentTo);
  // A single printed appointment is a point-in-time, not an open-ended window.
  const from = printedFrom ?? printedTo;
  const to = printedFrom && printedTo ? printedTo : null;
  return {
    ...stop,
    appointmentFrom: zonedDateTime(from, timeZone),
    appointmentTo: zonedDateTime(to, timeZone),
    appointmentTimezone: timeZone,
  };
}

function stopPayload(stop: ReturnType<typeof normalizeStop>, fallback: string) {
  const city = text(stop.city, "Aniqlanmadi")!;
  const region = text(stop.region, "--")!;
  return {
    facilityName: text(stop.facilityName, fallback),
    addressLine: text(stop.addressLine, [city, region].join(", ")),
    city,
    region,
    postalCode: text(stop.postalCode),
    latitude: null,
    longitude: null,
    appointmentFrom: stop.appointmentFrom,
    appointmentTo: stop.appointmentTo,
    requiresDocument: true,
  };
}

function normalizeMissingFields(
  extracted: LoadExtraction,
  pickup: ReturnType<typeof normalizeStop>,
  delivery: ReturnType<typeof normalizeStop>,
) {
  const values = Array.isArray(extracted.missingFields)
    ? extracted.missingFields.filter((value) => typeof value === "string")
      .map((value) => value.trim()).filter(Boolean)
    : [];
  const filtered = values.filter((value) => {
    const key = value.toLowerCase();
    if (pickup.appointmentFrom && key.includes("pickup") && key.includes("appointment")) {
      return false;
    }
    if (delivery.appointmentFrom && key.includes("delivery") && key.includes("appointment")) {
      return false;
    }
    return true;
  });
  if (extracted.brokerRate == null) filtered.push("brokerRate");
  if (extracted.loadedMiles == null) filtered.push("loadedMiles");
  if (!pickup.appointmentFrom) filtered.push("pickup.appointment");
  if (!delivery.appointmentFrom) filtered.push("delivery.appointment");
  if (!text(extracted.broker?.phone)) filtered.push("broker.phone");
  if (!text(extracted.pickup?.contactPhone)) filtered.push("pickup.contactPhone");
  if (!text(extracted.delivery?.contactPhone)) filtered.push("delivery.contactPhone");
  return [...new Set(filtered)];
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
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_LOAD_MODEL") ?? "gpt-4.1-mini";
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey || !openAiKey) {
    return json({ error: "Function environment is incomplete" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

  const { data: profile } = await callerClient
    .from("profiles")
    .select("id,company_id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (
    !profile || profile.status !== "active" || !profile.company_id ||
    !["company_admin", "dispatcher"].includes(profile.role)
  ) {
    return json({ error: "Dispatcher permission required" }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Fayl form-data ko'rinishida yuborilishi kerak" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "PDF yoki surat tanlang" }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return json({ error: "Fayl hajmi 20 MB dan oshmasligi kerak" }, 413);
  }
  if (file.type !== "application/pdf" && !SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return json({ error: "Faqat PDF, JPG, PNG, WEBP yoki GIF qabul qilinadi" }, 415);
  }
  if (!hasExpectedExtension(file)) {
    return json({ error: "Fayl turi va kengaytmasi bir-biriga mos emas" }, 415);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedSignature(file.type, bytes)) {
    return json({ error: "Fayl tarkibi PDF yoki qo'llab-quvvatlanadigan surat emas" }, 415);
  }
  const checksum = await sha256(bytes);
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentImportCount, error: countError } = await adminClient
    .from("manual_load_imports")
    .select("id", { count: "exact", head: true })
    .eq("created_by", profile.id)
    .gte("created_at", oneHourAgo);
  if (countError) return json({ error: "AI limitini tekshirib bo'lmadi" }, 500);
  if ((recentImportCount ?? 0) >= 20) {
    return json({ error: "Bir soatlik AI hujjat limiti tugadi" }, 429);
  }

  const { data: existing } = await adminClient
    .from("manual_load_imports")
    .select("id,status,load_id,extracted_result,error_message,updated_at,extraction_schema_version")
    .eq("company_id", profile.company_id)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (
    ["extracted", "needs_review"].includes(existing?.status ?? "") &&
    existing?.load_id &&
    Number(existing?.extraction_schema_version ?? 1) >= 2
  ) {
    return json({
      loadId: existing.load_id,
      preparedLoad: existing.extracted_result,
      duplicate: true,
    });
  }
  const processingIsFresh = existing?.status === "processing" &&
    Date.now() - new Date(existing.updated_at).getTime() < 10 * 60 * 1000;
  if (processingIsFresh) {
    return json({ error: "Bu hujjat hozir tahlil qilinmoqda" }, 409);
  }

  let importId = existing?.id as string | undefined;
  if (importId) {
    await adminClient.from("manual_load_imports").update({
      status: "processing",
      error_message: null,
    }).eq("id", importId);
  } else {
    const { data: created, error } = await adminClient
      .from("manual_load_imports")
      .insert({
        company_id: profile.company_id,
        created_by: profile.id,
        checksum_sha256: checksum,
        source_file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);
    importId = created.id;
  }

  const fail = async (message: string, status = 422) => {
    await adminClient.from("manual_load_imports").update({
      status: "parse_failed",
      error_message: message.slice(0, 4000),
    }).eq("id", importId!);
    return json({ error: message }, status);
  };

  try {
    const manualUpload = await uploadPrivateMedia({
      supabaseUrl,
      apiKey: publicKey,
      authorization,
      file,
      scope: "manual_import",
      contextId: importId,
    });
    const storagePath = manualUpload.reference;
    await adminClient.from("manual_load_imports").update({ storage_path: storagePath })
      .eq("id", importId);

    const extracted = await extractLoad(file, bytes, openAiKey, model);
    const normalizedPickup = normalizeStop(extracted.pickup);
    const normalizedDelivery = normalizeStop(extracted.delivery);
    const pickupCity = text(extracted.pickup?.city);
    const deliveryCity = text(extracted.delivery?.city);
    if (!pickupCity || !deliveryCity) {
      return await fail(
        "AI pickup va delivery manzilini aniq topa olmadi. Boshqa yoki tiniqroq hujjat yuklang.",
      );
    }

    const generatedLoadNumber = `AI-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${checksum.slice(0, 8).toUpperCase()}`;
    const loadNumber = text(extracted.loadNumber, generatedLoadNumber)!;
    let loadId = existing?.load_id as string | undefined;
    const isRefresh = Boolean(loadId);
    let documentVersionId: string | null = null;
    if (!loadId) {
      const { data: createdLoadId, error: createError } = await callerClient.rpc(
        "create_load_draft",
        {
          load_number: loadNumber.replace(/^#/, ""),
          broker_name: text(extracted.broker?.name, "Broker aniqlanmadi"),
          cargo_description: text(extracted.cargoDescription, "Yuk tavsifi aniqlanmadi"),
          equipment_type: text(extracted.equipmentType, "Aniqlanmadi"),
          weight_lbs: integer(extracted.weightLbs),
          broker_rate: number(extracted.brokerRate),
          loaded_miles: number(extracted.loadedMiles),
          pickup: stopPayload(normalizedPickup, "Pickup"),
          delivery: stopPayload(normalizedDelivery, "Delivery"),
          broker_message_id: null,
        },
      );
      if (createError) return await fail(createError.message, 409);
      loadId = createdLoadId;
    }
    if (!loadId) return await fail("Yuk yaratilmadi", 500);

    const requirements = Array.isArray(extracted.requirements)
      ? extracted.requirements.map((value) => text(value)).filter(Boolean)
      : [];
    const { error: metadataError } = await callerClient.rpc(
      isRefresh ? "refresh_ai_import_metadata" : "apply_ai_import_metadata",
      {
        target_load_id: loadId,
        broker_contact: {
          name: text(extracted.broker?.contactName),
          phone: text(extracted.broker?.phone),
          email: text(extracted.broker?.email),
          fax: text(extracted.broker?.fax),
        },
        freight_details: {
          mode: text(extracted.freightMode),
          temperatureFahrenheit: extracted.temperatureFahrenheit,
          palletCount: integer(extracted.palletCount),
          caseCount: extracted.caseCount == null ? null : Math.max(0, Math.round(extracted.caseCount)),
          isHazmat: typeof extracted.isHazmat === "boolean" ? extracted.isHazmat : null,
          specialInstructions: text(extracted.specialInstructions),
          requirements,
        },
        pickup_details: {
          contactName: text(extracted.pickup?.contactName),
          contactPhone: text(extracted.pickup?.contactPhone),
          appointmentTimezone: normalizedPickup.appointmentTimezone,
        },
        delivery_details: {
          contactName: text(extracted.delivery?.contactName),
          contactPhone: text(extracted.delivery?.contactPhone),
          appointmentTimezone: normalizedDelivery.appointmentTimezone,
        },
      },
    );
    if (metadataError) return await fail(metadataError.message, 500);

    if (!isRefresh) {
      const { error: approveError } = await callerClient.rpc("approve_load_draft", {
        load_id: loadId,
      });
      if (approveError) return await fail(approveError.message, 500);

      const { data: uploadPlan, error: planError } = await callerClient.rpc(
        "begin_document_upload",
        {
          load_id: loadId,
          stop_id: null,
          document_type: "rate_confirmation",
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        },
      );
      if (planError) return await fail(planError.message, 500);
      const documentUpload = await uploadPrivateMedia({
        supabaseUrl,
        apiKey: publicKey,
        authorization,
        file,
        scope: "load_document",
        contextId: loadId,
      });
      const { error: completeError } = await callerClient.rpc(
        "bind_document_version_media",
        {
          version_id: uploadPlan.versionId,
          media_ref: documentUpload.reference,
          checksum_sha256: checksum,
        },
      );
      if (completeError) return await fail(completeError.message, 500);
      documentVersionId = uploadPlan.versionId;
    } else {
      const { data: existingDocument } = await adminClient.from("documents")
        .select("current_version_id")
        .eq("load_id", loadId)
        .eq("document_type", "rate_confirmation")
        .not("current_version_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      documentVersionId = existingDocument?.current_version_id ?? null;
    }

    const missingFields = normalizeMissingFields(
      extracted,
      normalizedPickup,
      normalizedDelivery,
    );
    const preparedLoad = {
      id: loadId,
      loadNumber: `#${loadNumber.replace(/^#/, "")}`,
      broker: text(extracted.broker?.name, "Broker aniqlanmadi"),
      brokerContact: text(extracted.broker?.contactName),
      brokerPhone: text(extracted.broker?.phone),
      brokerEmail: text(extracted.broker?.email),
      brokerFax: text(extracted.broker?.fax),
      rate: number(extracted.brokerRate),
      distanceMiles: number(extracted.loadedMiles),
      equipment: text(extracted.equipmentType, "Aniqlanmadi"),
      freightMode: text(extracted.freightMode),
      temperatureFahrenheit: extracted.temperatureFahrenheit,
      palletCount: integer(extracted.palletCount),
      caseCount: extracted.caseCount == null ? null : Math.max(0, Math.round(extracted.caseCount)),
      isHazmat: typeof extracted.isHazmat === "boolean" ? extracted.isHazmat : null,
      specialInstructions: text(extracted.specialInstructions),
      requirements,
      weightLbs: integer(extracted.weightLbs),
      commodity: text(extracted.cargoDescription, "Yuk tavsifi aniqlanmadi"),
      origin: {
        city: pickupCity,
        state: text(extracted.pickup.region, "--"),
        facility: text(extracted.pickup.facilityName, "Pickup"),
        address: text(extracted.pickup.addressLine, pickupCity),
        postalCode: text(extracted.pickup.postalCode),
        appointmentFrom: normalizedPickup.appointmentFrom,
        appointmentTo: normalizedPickup.appointmentTo,
        appointmentTimezone: normalizedPickup.appointmentTimezone,
        contactName: text(extracted.pickup.contactName),
        contactPhone: text(extracted.pickup.contactPhone),
      },
      destination: {
        city: deliveryCity,
        state: text(extracted.delivery.region, "--"),
        facility: text(extracted.delivery.facilityName, "Delivery"),
        address: text(extracted.delivery.addressLine, deliveryCity),
        postalCode: text(extracted.delivery.postalCode),
        appointmentFrom: normalizedDelivery.appointmentFrom,
        appointmentTo: normalizedDelivery.appointmentTo,
        appointmentTimezone: normalizedDelivery.appointmentTimezone,
        contactName: text(extracted.delivery.contactName),
        contactPhone: text(extracted.delivery.contactPhone),
      },
      fileName: file.name,
      confidence: number(extracted.confidence),
      missingFields,
    };

    const { data: check } = documentVersionId
      ? await adminClient.from("document_checks").select("id")
        .eq("document_version_id", documentVersionId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    if (check?.id) {
      const checkWarnings = missingFields.map((field) => ({
        code: "ai_missing_field",
        message: `AI hujjatdan ${field} maydonini aniq topa olmadi.`,
      }));
      const { error: checkError } = await adminClient.rpc("record_document_check", {
        check_id: check.id,
        next_status: checkWarnings.length ? "warning" : "passed",
        confidence: number(extracted.confidence),
        model_name: model,
        result: {
          source: "load_import",
          loadNumber: preparedLoad.loadNumber,
          missingFields,
        },
        warnings: checkWarnings,
      });
      if (checkError) console.error("Could not record import document check", checkError.message);
      if (!checkError) {
        await adminClient.from("jobs").update({
          status: "completed",
          last_error: null,
        }).eq("idempotency_key", `document-check:${documentVersionId}`);
      }
    }

    await adminClient.from("manual_load_imports").update({
      status: preparedLoad.missingFields.length ? "needs_review" : "extracted",
      model_name: model,
      extracted_result: preparedLoad,
      raw_extraction: extracted,
      extraction_schema_version: 2,
      load_id: loadId,
      error_message: null,
    }).eq("id", importId);
    await adminClient.from("audit_events").insert({
      company_id: profile.company_id,
      actor_id: profile.id,
      action: isRefresh ? "load.ai_import_refreshed" : "load.ai_imported",
      entity_type: "load",
      entity_id: loadId,
      new_value: { importId, model, confidence: preparedLoad.confidence },
    });

    return json({ loadId, preparedLoad, duplicate: isRefresh, refreshed: isRefresh });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI tahlili bajarilmadi";
    return await fail(message, 502);
  }
});
