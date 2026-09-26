import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { downloadPrivateMedia } from "../_shared/cloudinary-media.ts";

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


function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function proposalFromExtraction(
  extracted: LoadExtraction,
  fileName: string,
  checksum: string,
) {
  const pickup = normalizeStop(extracted.pickup);
  const delivery = normalizeStop(extracted.delivery);
  const missingFields = normalizeMissingFields(extracted, pickup, delivery);
  const generatedLoadNumber = `AI-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${checksum.slice(0, 8).toUpperCase()}`;
  const loadNumber = text(extracted.loadNumber, generatedLoadNumber)!;
  const requirements = Array.isArray(extracted.requirements)
    ? extracted.requirements.map((value) => text(value)).filter(Boolean)
    : [];
  return {
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
      city: text(extracted.pickup.city, "Aniqlanmadi"),
      state: text(extracted.pickup.region, "--"),
      facility: text(extracted.pickup.facilityName, "Pickup"),
      address: text(extracted.pickup.addressLine),
      postalCode: text(extracted.pickup.postalCode),
      appointmentFrom: pickup.appointmentFrom,
      appointmentTo: pickup.appointmentTo,
      appointmentTimezone: pickup.appointmentTimezone,
      contactName: text(extracted.pickup.contactName),
      contactPhone: text(extracted.pickup.contactPhone),
    },
    destination: {
      city: text(extracted.delivery.city, "Aniqlanmadi"),
      state: text(extracted.delivery.region, "--"),
      facility: text(extracted.delivery.facilityName, "Delivery"),
      address: text(extracted.delivery.addressLine),
      postalCode: text(extracted.delivery.postalCode),
      appointmentFrom: delivery.appointmentFrom,
      appointmentTo: delivery.appointmentTo,
      appointmentTimezone: delivery.appointmentTimezone,
      contactName: text(extracted.delivery.contactName),
      contactPhone: text(extracted.delivery.contactPhone),
    },
    fileName,
    confidence: number(extracted.confidence),
    missingFields,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = Deno.env.get("GMAIL_WORKER_TOKEN");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_LOAD_MODEL") ?? "gpt-4.1-mini";
  const token = request.headers.get("X-Worker-Token") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !workerToken || !openAiKey) {
    return json({ error: "Function environment is incomplete" }, 500);
  }
  if (!secureEqual(token, workerToken)) return json({ error: "Worker authentication required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let attachmentId = "";
  try {
    const body = await request.json();
    attachmentId = typeof body?.attachmentId === "string" ? body.attachmentId : "";
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!attachmentId) return json({ error: "attachmentId is required" }, 400);

  const { data: attachment, error: attachmentError } = await admin
    .from("broker_attachments")
    .select("id,company_id,message_id,file_name,mime_type,storage_path,checksum_sha256,size_bytes")
    .eq("id", attachmentId)
    .maybeSingle();
  if (attachmentError) return json({ error: attachmentError.message }, 500);
  if (!attachment) return json({ error: "Attachment not found" }, 404);
  if (attachment.mime_type !== "application/pdf" && !SUPPORTED_IMAGE_TYPES.has(attachment.mime_type)) {
    return json({ error: "Faqat PDF, JPG, PNG, WEBP yoki GIF tahlil qilinadi" }, 415);
  }
  const fileProbe = new File([], attachment.file_name, { type: attachment.mime_type });
  if (!hasExpectedExtension(fileProbe)) {
    return json({ error: "Fayl turi va kengaytmasi bir-biriga mos emas" }, 415);
  }
  if (Number(attachment.size_bytes || 0) > MAX_FILE_BYTES) {
    return json({ error: "Fayl hajmi 20 MB dan oshmasligi kerak" }, 413);
  }

  const { data: existing } = await admin.from("ai_extractions")
    .select("id,status,result")
    .eq("message_id", attachment.message_id)
    .eq("attachment_id", attachment.id)
    .maybeSingle();
  if (existing && ["extracted", "needs_review"].includes(existing.status ?? "")) {
    return json({ extractionId: existing.id, proposal: existing.result, duplicate: true });
  }

  await admin.from("broker_messages").update({ status: "processing", error_message: null })
    .eq("id", attachment.message_id);

  const fail = async (message: string, status = 422) => {
    const { error } = await admin.rpc("record_ai_extraction", {
      message_id: attachment.message_id,
      attachment_id: attachment.id,
      next_status: "parse_failed",
      model_name: model,
      schema_version: 2,
      result: {},
      fields: [],
      error_message: message.slice(0, 4000),
    });
    if (error) console.error("Could not record failed extraction", error.message);
    return json({ error: message }, status);
  };

  try {
    const blob = await downloadPrivateMedia({
      admin,
      bucket: "broker-originals",
      reference: attachment.storage_path,
      supabaseUrl,
      serviceRoleKey,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!hasExpectedSignature(attachment.mime_type, bytes)) {
      return await fail("Biriktirma nomi va fayl tarkibi bir-biriga mos emas");
    }
    const file = new File([bytes], safeFileName(attachment.file_name), { type: attachment.mime_type });
    const extracted = await extractLoad(file, bytes, openAiKey, model);
    const proposal = proposalFromExtraction(extracted, attachment.file_name, attachment.checksum_sha256);
    const nextStatus = proposal.missingFields.length ? "needs_review" : "extracted";
    const fields = Object.entries(proposal).map(([name, value]) => ({
      name,
      value,
      confidence: proposal.confidence,
      sourceReference: attachment.file_name,
    }));
    const { data: saved, error: recordError } = await admin.rpc("record_ai_extraction", {
      message_id: attachment.message_id,
      attachment_id: attachment.id,
      next_status: nextStatus,
      model_name: model,
      schema_version: 2,
      result: proposal,
      fields,
      error_message: null,
    });
    if (recordError) return await fail(recordError.message, 500);
    return json({ extractionId: saved.id, proposal, status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI tahlili bajarilmadi";
    return await fail(message, 502);
  }
});
