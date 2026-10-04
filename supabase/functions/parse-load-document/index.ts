import { withCors } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkDistributedRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { uploadPrivateMedia } from "../_shared/cloudinary-media.ts";
import { verifyLoadExtraction, EVIDENCE_PATHS } from "../_shared/load-extraction-verification.ts";
import { documentReviewSchema, runSinglePassExtraction } from "../_shared/load-single-pass.ts";
import { sourcedExtractionSchema, decodeSourcedExtraction } from "../_shared/load-sourced-fields.ts";
import { correctExtraction } from "../_shared/load-corrections.ts";
import { reusableLoadImport } from "../_shared/load-import-cache.ts";
import { issueLoadPreviewTicket, verifyLoadPreviewTicket } from "../_shared/load-preview-ticket.ts";
import { EXTRA_DOCUMENT_FIELDS, EXTRA_DOCUMENT_PROPERTIES, EXTRA_STOP_FIELDS, EXTRA_STOP_PROPERTIES, DOCUMENT_EXTRACTION_VERSION, DOCUMENT_DETAIL_INSTRUCTIONS } from "../_shared/load-document-fields.ts";

const corsHeaders = {
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
  appointmentPrinted: string | null;
  referenceNumber: string | null;
  readyDate: string | null;
  hours: string | null;
  appointmentReference: string | null;
  orderReferences: string | null;
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
  pieceCount: number | null;
  packageCount: number | null;
  isHazmat: boolean | null;
  specialInstructions: string | null;
  requirements: string[];
  weightLbs: number | null;
  weightPrinted: string | null;
  brokerRate: number | null;
  loadedMiles: number | null;
  pickup: StopExtraction;
  delivery: StopExtraction;
  confidence: number;
  missingFields: string[];
  evidence: { field: string; page: number; quote: string }[];
  pickupCount: number;
  deliveryCount: number;
};

const stopSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...EXTRA_STOP_PROPERTIES,
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
    appointmentPrinted: { type: ["string", "null"] },
    referenceNumber: { type: ["string", "null"] },
    readyDate: { type: ["string", "null"] },
    hours: { type: ["string", "null"] },
    appointmentReference: { type: ["string", "null"] },
    orderReferences: { type: ["string", "null"] },
  },
  required: [
    ...EXTRA_STOP_FIELDS,
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
    "appointmentPrinted",
    "referenceNumber",
    "readyDate", "hours", "appointmentReference", "orderReferences",
  ],
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...EXTRA_DOCUMENT_PROPERTIES,
    documentReview: documentReviewSchema,
    contractTerms: { type: 'array', maxItems: 128, items: { type: 'string' } },
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
    pieceCount: { type: ["integer", "null"] },
    packageCount: { type: ["integer", "null"] },
    isHazmat: { type: ["boolean", "null"] },
    specialInstructions: { type: ["string", "null"] },
    requirements: { type: "array", items: { type: "string" } },
    weightLbs: { type: ["integer", "null"] },
    weightPrinted: { type: ["string", "null"] },
    brokerRate: { type: ["number", "null"] },
    loadedMiles: { type: ["number", "null"] },
    pickup: stopSchema,
    delivery: stopSchema,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingFields: { type: "array", items: { type: "string" } },
    pickupCount: { type: "integer" },
    deliveryCount: { type: "integer" },
    evidence: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: { field: { type: "string", enum: EVIDENCE_PATHS }, page: { type: "integer" }, quote: { type: "string" } },
      required: ["field", "page", "quote"],
    } },
  },
  required: [
    'documentReview',
    ...EXTRA_DOCUMENT_FIELDS, 'contractTerms',
    "evidence", "pickupCount", "deliveryCount",
    "loadNumber",
    "broker",
    "freightMode",
    "cargoDescription",
    "equipmentType",
    "temperatureFahrenheit",
    "palletCount",
    "caseCount",
    "pieceCount", "packageCount",
    "isHazmat",
    "specialInstructions",
    "requirements",
    "weightLbs",
    "weightPrinted",
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
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function inferredTimezone(stop: StopExtraction) {
  const supplied = text(stop.appointmentTimezone);
  if (supplied) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: supplied }).format();
      return supplied;
    } catch {
      // Keep unknown timezones unknown; several states span multiple zones.
    }
  }
  return null;
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

async function extractLoad(file: File, bytes: Uint8Array, apiKey: string, model: string): Promise<LoadExtraction> {
  const base64 = toBase64(bytes);
  const documentInput = file.type === "application/pdf"
    ? { type: "input_file", filename: safeFileName(file.name), file_data: `data:application/pdf;base64,${base64}` }
    : { type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" };
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, store: false,
      instructions: DOCUMENT_DETAIL_INSTRUCTIONS,
      input: [{ role: "user", content: [documentInput, { type: "input_text", text: 'Read the attached original document directly. No separately extracted text is supplied. Use the provided schema: scalar facts are {value,page,quote}; for absent facts set all three null. requirements and contractTerms are {value,page}: value is the FULL verbatim source text itself, so do NOT duplicate it in a quote. Include a page and short exact quote when visible, but never invent a citation. '
        + 'Do not return a separate evidence list. stops contains ALL stops in printed travel order, including multiple pickups and deliveries; a multi-stop shipment is still singleLoad=true. Put date, booked time, opening hours and call-ahead/FCFS timingNote in separate fields. Keep clauses verbatim with every qualifier. Check the shipment number (not filename), rate, all stop roles, addresses, dates and missing instructions. documentReview.pageCount is the actual page count; allPagesRead must be false if any page was skipped or unreadable.' }] }],
      text: { format: { type: "json_schema", name: "trucking_load_document", strict: true, schema: sourcedExtractionSchema(extractionSchema, stopSchema) } },
    }),
  }).catch(error => { if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('AI_DOCUMENT_TIMEOUT'); throw error; });
  const payload = await response.json().catch(() => ({}));
  console.info(JSON.stringify({ event: "load_import_ai", model, durationMs: Math.round(performance.now() - started),
    status: response.status, inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens }));
  if (!response.ok) throw new Error(response.status === 429
    ? "AI limiti vaqtincha tugadi. Birozdan keyin qayta urinib ko'ring."
    : "AI hujjatni tahlil qila olmadi. Birozdan keyin qayta urinib ko'ring.");
  if (payload.status !== 'completed') throw new Error('AI javobi to‘liq kelmadi. Hujjat yuborishga tayyor deb belgilanmadi.');
  const candidate = decodeSourcedExtraction(JSON.parse(outputText(payload)));
  // This server-owned marker is included in the signed preview ticket. The
  // model's page/quote claims are displayed, never treated as PDF verification.
  if (file.type === 'application/pdf') candidate.extractionMode = 'ai_pdf_direct';
  return candidate as LoadExtraction;
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

async function extractAndVerify(file: File, bytes: Uint8Array, apiKey: string, model: string) {
  const started = performance.now();
  try {
    const result = await runSinglePassExtraction(() => extractLoad(file, bytes, apiKey, model),
      candidate => verifyLoadExtraction(candidate, null, true));
    if ((result.candidate as any).extractionMode === 'ai_pdf_direct') result.audit.method = 'ai_pdf_direct';
    console.info(JSON.stringify({ event: 'load_import_validation', method: result.audit.method, aiCalls: 1,
      durationMs: Math.round(performance.now() - started), blockedFields: result.verified.review.blockingFields.length }));
    return result;
  } catch (error) {
    console.info(JSON.stringify({ event: 'load_import_validation',
      durationMs: Math.round(performance.now() - started), failed: true }));
    throw error;
  }
}

function stopPayload(stop: ReturnType<typeof normalizeStop>) {
  const city = text(stop.city, "")!;
  const region = text(stop.region, "")!;
  return {
    facilityName: text(stop.facilityName),
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
  if (!text(extracted.broker?.name)) filtered.push("broker.name");
  if (!text(extracted.cargoDescription)) filtered.push("cargoDescription");
  if (!text(extracted.equipmentType)) filtered.push("equipmentType");
  if (!text(extracted.pickup?.city)) filtered.push("pickup.city");
  if (!text(extracted.pickup?.region)) filtered.push("pickup.region");
  if (!text(extracted.pickup?.facilityName)) filtered.push("pickup.facilityName");
  if (!text(extracted.delivery?.city)) filtered.push("delivery.city");
  if (!text(extracted.delivery?.region)) filtered.push("delivery.region");
  if (!text(extracted.delivery?.facilityName)) filtered.push("delivery.facilityName");
  if (!pickup.appointmentFrom && !pickup.appointmentPrinted) filtered.push("pickup.appointment");
  if (!delivery.appointmentFrom && !delivery.appointmentPrinted) filtered.push("delivery.appointment");
  if (!text(extracted.broker?.phone)) filtered.push("broker.phone");
  if (!text(extracted.pickup?.contactPhone)) filtered.push("pickup.contactPhone");
  if (!text(extracted.delivery?.contactPhone)) filtered.push("delivery.contactPhone");
  return [...new Set(filtered)];
}

function preparedSnapshot(file: File, checksum: string, verified: ReturnType<typeof verifyLoadExtraction>,
  loadId: string | null = null) {
  const extracted = { ...verified.safe, confidence: 0, missingFields: verified.missingFields } as LoadExtraction;
  const normalizedPickup = normalizeStop(extracted.pickup);
  const normalizedDelivery = normalizeStop(extracted.delivery);
  const normalizedStops = (verified.safe.stops ?? [{ ...extracted.pickup, role: 'pickup' }, { ...extracted.delivery, role: 'delivery' }])
    .map((stop: any) => ({ ...normalizeStop(stop), role: stop.role }));
  const pickupCity = text(extracted.pickup?.city);
  const deliveryCity = text(extracted.delivery?.city);
  if (!pickupCity || !deliveryCity) throw Error('AI pickup va delivery shahrini aniq topa olmadi. Boshqa hujjat yuklang.');
  const generatedLoadNumber = `AI-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${checksum.slice(0, 8).toUpperCase()}`;
  const loadNumber = text(extracted.loadNumber, generatedLoadNumber)!;
  const driverBrief = { ...verified.driverBrief, sourceFileName: file.name, checksum,
    aiDirect: verified.review.method === 'ai_pdf_direct',
    blockingFields: verified.review.blockingFields, reviewedAt: null };
  const requirements = Array.isArray(extracted.requirements)
    ? extracted.requirements.map(value => text(value)).filter(Boolean) : [];
  const missingFields = normalizeMissingFields(extracted, normalizedPickup, normalizedDelivery);
  const preparedLoad = {
    review: { ...verified.review, checksum }, driverBrief,
    documentDetails: verified.documentDetails, stops: normalizedStops,
    id: loadId, loadNumber: `#${loadNumber.replace(/^#/, '')}`,
    broker: text(extracted.broker?.name), brokerContact: text(extracted.broker?.contactName),
    brokerPhone: text(extracted.broker?.phone), brokerEmail: text(extracted.broker?.email),
    brokerFax: text(extracted.broker?.fax), rate: extracted.brokerRate ?? null,
    distanceMiles: extracted.loadedMiles ?? null, equipment: text(extracted.equipmentType),
    freightMode: text(extracted.freightMode), temperatureFahrenheit: extracted.temperatureFahrenheit,
    palletCount: integer(extracted.palletCount),
    caseCount: extracted.caseCount == null ? null : Math.max(0, Math.round(extracted.caseCount)),
    isHazmat: typeof extracted.isHazmat === 'boolean' ? extracted.isHazmat : null,
    specialInstructions: text(extracted.specialInstructions), requirements,
    weightLbs: integer(extracted.weightLbs), commodity: text(extracted.cargoDescription),
    origin: {
      city: pickupCity, state: text(extracted.pickup.region), facility: text(extracted.pickup.facilityName),
      address: text(extracted.pickup.addressLine, pickupCity), postalCode: text(extracted.pickup.postalCode),
      appointmentFrom: normalizedPickup.appointmentFrom, appointmentTo: normalizedPickup.appointmentTo,
      appointmentTimezone: normalizedPickup.appointmentTimezone,
      contactName: text(extracted.pickup.contactName), contactPhone: text(extracted.pickup.contactPhone),
    },
    destination: {
      city: deliveryCity, state: text(extracted.delivery.region), facility: text(extracted.delivery.facilityName),
      address: text(extracted.delivery.addressLine, deliveryCity), postalCode: text(extracted.delivery.postalCode),
      appointmentFrom: normalizedDelivery.appointmentFrom, appointmentTo: normalizedDelivery.appointmentTo,
      appointmentTimezone: normalizedDelivery.appointmentTimezone,
      contactName: text(extracted.delivery.contactName), contactPhone: text(extracted.delivery.contactPhone),
    },
    fileName: file.name, confidence: null, missingFields,
  };
  return { extracted, normalizedPickup, normalizedDelivery, normalizedStops,
    pickupCity, deliveryCity, loadNumber, driverBrief, requirements, missingFields, preparedLoad };
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
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_LOAD_MODEL") ?? "gpt-4.1-mini";
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey || !openAiKey) {
    return json({ error: "Function environment is incomplete" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
  const limit = await checkDistributedRateLimit(admin, "parse-load-document", authData.user.id, {
    limit: 30,
    windowMs: 5 * 60_000,
    supabaseUrl,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

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
  // Do not reuse old worker-backed, source-verified PDF snapshots for AI-only previews.
  const directPdf = file.type === 'application/pdf';
  const extractionVersion = DOCUMENT_EXTRACTION_VERSION + (directPdf ? 2 : 0);
  let corrections: any = null;
  if (form.has('corrections')) {
    try { corrections = JSON.parse(String(form.get('corrections'))); }
    catch { return json({ error: 'Invalid corrections' }, 400); }
  }
  const adminClient = admin;
  const brokerMessageId = form.get('brokerMessageId');
  const brokerAttachmentId = form.get('brokerAttachmentId');
  if (brokerMessageId !== null || brokerAttachmentId !== null) {
    if (typeof brokerMessageId !== 'string' || typeof brokerAttachmentId !== 'string'
      || !brokerMessageId || !brokerAttachmentId) {
      return json({ error: 'Broker xati va hujjati birga tanlanishi kerak' }, 422);
    }
    const { data: brokerAttachment, error: brokerError } = await adminClient.from('broker_attachments')
      .select('id')
      .eq('id', brokerAttachmentId)
      .eq('message_id', brokerMessageId)
      .eq('company_id', profile.company_id)
      .eq('checksum_sha256', checksum)
      .maybeSingle();
    if (brokerError || !brokerAttachment) {
      return json({ error: 'Broker hujjati xatga mos kelmadi' }, 422);
    }
  }

  // Authenticated read-only diagnostic: exercises the real model without creating a load.
  if (form.get('auditOnly') === 'true') {
    try {
      return json(await extractAndVerify(file, bytes, openAiKey, model));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Extraction failed' }, 422);
    }
  }

  // A selected file is analyzed in memory only. No import, load, document or
  // media row is created until the dispatcher presses Assign to driver.
  if (form.get('previewOnly') === 'true') {
    if (form.has('confirmDriverId') || form.has('previewPayload')) return json({ error: 'PREVIEW_MODE_CONFLICT' }, 400);
    const previewLimit = await checkDistributedRateLimit(admin, 'load-preview-ai', profile.id, {
      limit: 20, windowMs: 60 * 60_000, supabaseUrl,
    });
    if (!previewLimit.allowed) return rateLimitResponse(previewLimit);
    try {
      const { candidate, verified } = await extractAndVerify(file, bytes, openAiKey, model);
      const previewTicket = await issueLoadPreviewTicket(candidate,
        { actorId: profile.id, companyId: profile.company_id, checksum,
          fileName: file.name, mimeType: file.type, version: extractionVersion }, serviceRoleKey);
      return json({ preparedLoad: { ...preparedSnapshot(file, checksum, verified).preparedLoad,
        previewTicket }, previewOnly: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Extraction failed' }, 422);
    }
  }

  const confirmDriverId = form.get('confirmDriverId');
  let confirmedPreview: null | { candidate: any; verified: ReturnType<typeof verifyLoadExtraction> } = null;
  if (confirmDriverId !== null) {
    if (typeof confirmDriverId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(confirmDriverId)
      || typeof form.get('previewPayload') !== 'string' || typeof form.get('previewSignature') !== 'string'
      || corrections) return json({ error: 'PREVIEW_TICKET_INVALID' }, 400);
    try {
      const candidate = await verifyLoadPreviewTicket({ payload: form.get('previewPayload'),
        signature: form.get('previewSignature') },
        { actorId: profile.id, companyId: profile.company_id, checksum,
          fileName: file.name, mimeType: file.type, version: extractionVersion }, serviceRoleKey);
      const verified = verifyLoadExtraction(candidate, null, true);
      preparedSnapshot(file, checksum, verified);
      confirmedPreview = { candidate, verified };
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'PREVIEW_TICKET_INVALID' }, 422);
    }
  }

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
    .select("id,status,load_id,extracted_result,raw_extraction,error_message,updated_at,extraction_schema_version")
    .eq("company_id", profile.company_id)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (!corrections && !confirmedPreview && reusableLoadImport(existing, extractionVersion, checksum, false)) {
    return json({
      loadId: existing.load_id,
      preparedLoad: existing.extracted_result,
      duplicate: true,
    });
  }
  const upgradeExisting = Boolean(existing?.load_id);
  if (upgradeExisting) {
    const { data: draft } = await callerClient.from('loads').select('status,current_assignment_id')
      .eq('id', existing!.load_id).maybeSingle();
    if (!draft || !['draft', 'review'].includes(draft.status) || draft.current_assignment_id) {
      return json({ error: 'Yuk haydovchiga berilgan. Uning hujjatini avtomatik almashtirib bo‘lmaydi.' }, 409);
    }
  }
  const processingIsFresh = existing?.status === "processing" &&
    Date.now() - new Date(existing.updated_at).getTime() < 10 * 60 * 1000;
  if (processingIsFresh) {
    return json({ processing: true, importId: existing!.id }, 202);
  }
  let correctedCandidate: any = null;
  if (corrections) {
    try {
      if (!existing?.load_id || !existing.raw_extraction?.candidate) throw Error('Original extraction is missing');
      if (Number(existing.extraction_schema_version) !== extractionVersion
        || (directPdf && existing.raw_extraction.candidate.extractionMode !== 'ai_pdf_direct')) throw Error('PDF_REIMPORT_REQUIRED');
      correctedCandidate = correctExtraction(existing.raw_extraction.candidate, corrections, profile.id);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid correction' }, 422);
    }
  }

  let importId = existing?.id as string | undefined;
  if (importId) {
    const { data: claimed, error: claimError } = await adminClient.from("manual_load_imports").update({
      status: "processing",
      error_message: null,
    }).eq("id", importId).eq('updated_at', existing!.updated_at).select('id').maybeSingle();
    if (claimError) return json({ error: 'IMPORT_STATUS_UNAVAILABLE' }, 500);
    if (!claimed) return json({ processing: true, importId }, 202);
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
    const importStarted = performance.now();
    const uploadStarted = performance.now();
    const manualUpload = await uploadPrivateMedia({
      supabaseUrl,
      apiKey: publicKey,
      authorization,
      file,
      scope: "manual_import",
      contextId: importId,
    });
    console.info(JSON.stringify({ event: 'load_import_stage', importId, stage: 'source_upload', durationMs: Math.round(performance.now() - uploadStarted) }));
    const storagePath = manualUpload.reference;
    await adminClient.from("manual_load_imports").update({ storage_path: storagePath })
      .eq("id", importId);

    // A retry after draft creation reuses only this contract's signed result.
    const savedExtraction = Number(existing?.extraction_schema_version) === extractionVersion
      && (!directPdf || existing?.raw_extraction?.candidate?.extractionMode === 'ai_pdf_direct')
      ? existing?.raw_extraction : null;
    if (existing?.load_id && !upgradeExisting && (!savedExtraction?.candidate || !savedExtraction?.audit)) {
      return await fail('Avval yaratilgan yukning tekshiruv nusxasi topilmadi. Mavjud yukni tekshiring.', 409);
    }
    const { candidate, audit, verified } = confirmedPreview
      ? { candidate: confirmedPreview.candidate,
        audit: { method: confirmedPreview.candidate.extractionMode === 'ai_pdf_direct' ? 'ai_pdf_direct' : 'single_pass_rules', independentAudit: false },
        verified: confirmedPreview.verified }
      : correctedCandidate
      ? { candidate: correctedCandidate, audit: { method: correctedCandidate.extractionMode === 'ai_pdf_direct' ? 'ai_pdf_direct' : 'single_pass_rules', independentAudit: false }, verified: verifyLoadExtraction(correctedCandidate, null, true) }
      : savedExtraction?.candidate && savedExtraction?.audit
      ? { ...savedExtraction, verified: verifyLoadExtraction(savedExtraction.candidate, null, true) }
      : await extractAndVerify(file, bytes, openAiKey, model);
    const persistStarted = performance.now();
    const snapshot = preparedSnapshot(file, checksum, verified);
    const { extracted, normalizedPickup, normalizedDelivery, normalizedStops,
      pickupCity, deliveryCity, loadNumber, driverBrief, requirements, missingFields } = snapshot;
    const { error: snapshotError } = upgradeExisting ? { error: null } : await adminClient.from('manual_load_imports').update({
      raw_extraction: { candidate, audit }, extraction_schema_version: extractionVersion,
    }).eq('id', importId);
    if (snapshotError) return await fail('Hujjat tekshiruvini saqlab bo‘lmadi.', 500);

    let loadId = existing?.load_id as string | undefined;
    const isRefresh = Boolean(loadId);
    let documentVersionId: string | null = null;
    if (!loadId) {
      const { data: createdLoadId, error: createError } = await callerClient.rpc(
        "create_load_draft",
        {
          load_number: loadNumber.replace(/^#/, ""),
          broker_name: text(extracted.broker?.name),
          cargo_description: text(extracted.cargoDescription),
          equipment_type: text(extracted.equipmentType),
          weight_lbs: integer(extracted.weightLbs),
          broker_rate: number(extracted.brokerRate),
          loaded_miles: number(extracted.loadedMiles),
          pickup: stopPayload(normalizedPickup),
          delivery: stopPayload(normalizedDelivery),
          broker_message_id: typeof brokerMessageId === 'string' ? brokerMessageId : null,
        },
      );
      if (createError) return await fail(createError.code === '23505' ? 'LOAD_NUMBER_EXISTS' : createError.message, 409);
      loadId = createdLoadId;
    }
    if (!loadId) return await fail("Yuk yaratilmadi", 500);
    // Save a fixed template, never an AI-written summary. The driver sees this
    // exact snapshot only after a dispatcher checks it against the original.
    if (upgradeExisting) {
      const { error: upgradeError } = await adminClient.rpc('refresh_verified_import_draft', {
        target_import_id: importId, actor_id: profile.id, expected_checksum: checksum,
        extraction: { ...extracted, pickup: normalizedPickup, delivery: normalizedDelivery },
        verified_brief: driverBrief, raw_snapshot: { candidate, audit },
      });
      if (upgradeError) return await fail(upgradeError.message, 409);
    }
    const { error: briefError } = await adminClient.from('loads')
      .update({ driver_brief: driverBrief }).eq('id', loadId).eq('company_id', profile.company_id);
    if (briefError) return await fail(briefError.message, 500);
    const { error: linkError } = await adminClient.from('manual_load_imports')
      .update({ load_id: loadId, extraction_schema_version: extractionVersion }).eq('id', importId);
    if (linkError) return await fail('Yukni hujjatga bog‘lab bo‘lmadi.', 500);

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

    // Persist every stop before exposing the prepared snapshot to dispatch.
    const { error: stopsSaveError } = await adminClient.rpc('save_import_ordered_stops', {
      target_import_id: importId, actor_id: profile.id, expected_checksum: checksum, ordered_stops: normalizedStops,
    });
    if (stopsSaveError) return await fail(stopsSaveError.message, 409);

    const { data: previousDocument } = await adminClient.from('documents')
      .select('current_version_id').eq('load_id', loadId).eq('document_type', 'rate_confirmation')
      .not('current_version_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!previousDocument?.current_version_id) {
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
        contextId: uploadPlan.versionId,
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
      documentVersionId = previousDocument.current_version_id;
    }

    const preparedLoad = {
      review: { ...verified.review, checksum },
      driverBrief,
      // Staff-only snapshot persists in manual_load_imports, not the driver-visible brief.
      documentDetails: verified.documentDetails,
      stops: normalizedStops,
      id: loadId,
      loadNumber: `#${loadNumber.replace(/^#/, "")}`,
      broker: text(extracted.broker?.name),
      brokerContact: text(extracted.broker?.contactName),
      brokerPhone: text(extracted.broker?.phone),
      brokerEmail: text(extracted.broker?.email),
      brokerFax: text(extracted.broker?.fax),
      rate: extracted.brokerRate ?? null,
      distanceMiles: extracted.loadedMiles ?? null,
      equipment: text(extracted.equipmentType),
      freightMode: text(extracted.freightMode),
      temperatureFahrenheit: extracted.temperatureFahrenheit,
      palletCount: integer(extracted.palletCount),
      caseCount: extracted.caseCount == null ? null : Math.max(0, Math.round(extracted.caseCount)),
      isHazmat: typeof extracted.isHazmat === "boolean" ? extracted.isHazmat : null,
      specialInstructions: text(extracted.specialInstructions),
      requirements,
      weightLbs: integer(extracted.weightLbs),
      commodity: text(extracted.cargoDescription),
      origin: {
        city: pickupCity,
        state: text(extracted.pickup.region),
        facility: text(extracted.pickup.facilityName),
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
        state: text(extracted.delivery.region),
        facility: text(extracted.delivery.facilityName),
        address: text(extracted.delivery.addressLine, deliveryCity),
        postalCode: text(extracted.delivery.postalCode),
        appointmentFrom: normalizedDelivery.appointmentFrom,
        appointmentTo: normalizedDelivery.appointmentTo,
        appointmentTimezone: normalizedDelivery.appointmentTimezone,
        contactName: text(extracted.delivery.contactName),
        contactPhone: text(extracted.delivery.contactPhone),
      },
      fileName: file.name,
      confidence: null,
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
        field,
        params: { field },
      }));
      const { error: checkError } = await adminClient.rpc("record_document_check", {
        check_id: check.id,
        next_status: "warning",
        confidence: 0,
        model_name: model,
        result: {
          source: "load_import",
          loadNumber: preparedLoad.loadNumber,
          missingFields, reviewRequired: true,
          verificationMethod: 'single_pass_rules', independentAudit: false,
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

    const { error: saveError } = await adminClient.from("manual_load_imports").update({
      status: "needs_review",
      model_name: model,
      extracted_result: preparedLoad,
      raw_extraction: { candidate, audit },
      extraction_schema_version: extractionVersion,
      load_id: loadId,
      error_message: null,
    }).eq("id", importId);
    if (saveError) return await fail('Hujjat tekshiruvi saqlanmadi. Qayta urinib ko‘ring.', 500);
    if (confirmedPreview) {
      const { error: assignmentError } = await callerClient.rpc('review_and_assign_document_load', {
        target_load_id: loadId, target_driver_id: confirmDriverId, source_checksum: checksum,
      });
      if (assignmentError) {
        // The dispatcher pressed Send, but assignment failed. Keep the draft
        // recoverable and tell the UI explicitly that it was saved.
        return json({ error: 'ASSIGN_FAILED_DRAFT_SAVED', loadId, detail: assignmentError.message }, 409);
      }
    }
    console.info(JSON.stringify({ event: 'load_import_stage', importId, stage: 'persist', durationMs: Math.round(performance.now() - persistStarted) }));
    await adminClient.from("audit_events").insert({
      company_id: profile.company_id,
      actor_id: profile.id,
      action: isRefresh ? "load.ai_import_refreshed" : "load.ai_imported",
      entity_type: "load",
      entity_id: loadId,
      new_value: { importId, model, confidence: preparedLoad.confidence },
    });

    console.info(JSON.stringify({ event: 'load_import_complete', importId, durationMs: Math.round(performance.now() - importStarted), aiCalls: confirmedPreview || savedExtraction?.candidate ? 0 : 1 }));
    return json({ loadId, preparedLoad, duplicate: isRefresh, refreshed: isRefresh,
      assigned: Boolean(confirmedPreview) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI tahlili bajarilmadi";
    return await fail(message, 502);
  }
}));
