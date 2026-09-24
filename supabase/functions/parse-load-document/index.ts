import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  contactName: string | null;
  contactPhone: string | null;
};

type LoadExtraction = {
  loadNumber: string | null;
  broker: {
    name: string | null;
    contactName: string | null;
    phone: string | null;
  };
  cargoDescription: string | null;
  equipmentType: string | null;
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
      },
      required: ["name", "contactName", "phone"],
    },
    cargoDescription: { type: ["string", "null"] },
    equipmentType: { type: ["string", "null"] },
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
    "cargoDescription",
    "equipmentType",
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

function dateTime(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
        "You extract US trucking load data from broker rate confirmations and other load documents. Read only facts visible in the supplied file. Never invent missing values. Use null for unknown values. Dates must be RFC 3339 with an explicit timezone when the document supplies one; otherwise use null. Normalize US state names to two-letter codes. Keep phone numbers as printed. List every important missing or uncertain field in missingFields.",
      input: [{
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text:
              "Extract the load number, broker, route, appointments, rate, miles, equipment, weight, cargo, and contact details. Return the structured extraction.",
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

function stopPayload(stop: StopExtraction, fallback: string) {
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
    appointmentFrom: dateTime(stop.appointmentFrom),
    appointmentTo: dateTime(stop.appointmentTo),
    requiresDocument: true,
  };
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
    .select("id,status,load_id,extracted_result,error_message,updated_at")
    .eq("company_id", profile.company_id)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (
    ["extracted", "needs_review"].includes(existing?.status ?? "") &&
    existing?.load_id
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
    const storagePath = `${profile.company_id}/manual/${importId}/${safeFileName(file.name)}`;
    const { error: storageError } = await adminClient.storage
      .from("broker-originals")
      .upload(storagePath, bytes, { contentType: file.type, upsert: true });
    if (storageError) return await fail(storageError.message, 500);
    await adminClient.from("manual_load_imports").update({ storage_path: storagePath })
      .eq("id", importId);

    const extracted = await extractLoad(file, bytes, openAiKey, model);
    const pickupCity = text(extracted.pickup?.city);
    const deliveryCity = text(extracted.delivery?.city);
    if (!pickupCity || !deliveryCity) {
      return await fail(
        "AI pickup va delivery manzilini aniq topa olmadi. Boshqa yoki tiniqroq hujjat yuklang.",
      );
    }

    const generatedLoadNumber = `AI-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${checksum.slice(0, 8).toUpperCase()}`;
    const loadNumber = text(extracted.loadNumber, generatedLoadNumber)!;
    const { data: loadId, error: createError } = await callerClient.rpc(
      "create_load_draft",
      {
        load_number: loadNumber.replace(/^#/, ""),
        broker_name: text(extracted.broker?.name, "Broker aniqlanmadi"),
        cargo_description: text(extracted.cargoDescription, "Yuk tavsifi aniqlanmadi"),
        equipment_type: text(extracted.equipmentType, "Aniqlanmadi"),
        weight_lbs: integer(extracted.weightLbs),
        broker_rate: number(extracted.brokerRate),
        loaded_miles: number(extracted.loadedMiles),
        pickup: stopPayload(extracted.pickup, "Pickup"),
        delivery: stopPayload(extracted.delivery, "Delivery"),
        broker_message_id: null,
      },
    );
    if (createError) return await fail(createError.message, 409);

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
    const { error: uploadError } = await callerClient.storage
      .from(uploadPlan.bucket)
      .upload(uploadPlan.storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return await fail(uploadError.message, 500);
    const { error: completeError } = await callerClient.rpc(
      "complete_document_upload",
      { version_id: uploadPlan.versionId, checksum_sha256: checksum },
    );
    if (completeError) return await fail(completeError.message, 500);

    const preparedLoad = {
      id: loadId,
      loadNumber: `#${loadNumber.replace(/^#/, "")}`,
      broker: text(extracted.broker?.name, "Broker aniqlanmadi"),
      rate: number(extracted.brokerRate),
      distanceMiles: number(extracted.loadedMiles),
      equipment: text(extracted.equipmentType, "Aniqlanmadi"),
      weightLbs: integer(extracted.weightLbs),
      commodity: text(extracted.cargoDescription, "Yuk tavsifi aniqlanmadi"),
      origin: {
        city: pickupCity,
        state: text(extracted.pickup.region, "--"),
        facility: text(extracted.pickup.facilityName, "Pickup"),
        address: text(extracted.pickup.addressLine, pickupCity),
      },
      destination: {
        city: deliveryCity,
        state: text(extracted.delivery.region, "--"),
        facility: text(extracted.delivery.facilityName, "Delivery"),
        address: text(extracted.delivery.addressLine, deliveryCity),
      },
      fileName: file.name,
      confidence: number(extracted.confidence),
      missingFields: Array.isArray(extracted.missingFields)
        ? extracted.missingFields.filter((value) => typeof value === "string")
        : [],
    };

    await adminClient.from("manual_load_imports").update({
      status: preparedLoad.missingFields.length ? "needs_review" : "extracted",
      model_name: model,
      extracted_result: preparedLoad,
      load_id: loadId,
      error_message: null,
    }).eq("id", importId);
    await adminClient.from("audit_events").insert({
      company_id: profile.company_id,
      actor_id: profile.id,
      action: "load.ai_imported",
      entity_type: "load",
      entity_id: loadId,
      new_value: { importId, model, confidence: preparedLoad.confidence },
    });

    return json({ loadId, preparedLoad, duplicate: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI tahlili bajarilmadi";
    return await fail(message, 502);
  }
});
