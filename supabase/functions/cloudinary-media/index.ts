import { withCors } from "../_shared/cors.ts";
import { signedAuthenticatedDeliveryUrl } from "../_shared/cloudinary-delivery.ts";
import { canDeleteMedia } from "../_shared/media-permissions.ts";
import { checkDistributedRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { secureEqual } from "../_shared/secure-equal.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-token",
};
const MAX_BYTES = 50 * 1024 * 1024;
const allowedScopes = new Set([
  "chat", "profile_avatar", "driver_document", "load_document",
  "broker_original", "gmail_raw", "manual_import",
]);
const allowedTypes = [
  /^image\/(jpeg|png|webp|gif|heic|heif)$/,
  /^video\/(mp4|quicktime|webm)$/,
  /^audio\/(mpeg|mp4|ogg|webm|wav|x-m4a)$/,
  /^application\/pdf$/,
  /^application\/(octet-stream|zip)$/,
  /^message\/rfc822$/,
];
const scopeTypes: Record<string, RegExp[]> = {
  chat: allowedTypes.slice(0, 4),
  profile_avatar: [allowedTypes[0]],
  driver_document: [allowedTypes[0], allowedTypes[3]],
  load_document: [allowedTypes[0], allowedTypes[3]],
  manual_import: [allowedTypes[0], allowedTypes[3]],
  broker_original: allowedTypes,
  gmail_raw: allowedTypes,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function matchesMagic(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  const mime = file.type || "application/octet-stream";
  if (mime === "application/pdf") return ascii.startsWith("%PDF-");
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG";
  if (mime === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mime === "image/gif") return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
  if (/^image\/(heic|heif)$/.test(mime)) return ascii.slice(4, 8) === "ftyp";
  if (/^video\/(mp4|quicktime)$/.test(mime) || mime === "audio/mp4" || mime === "audio/x-m4a") return ascii.slice(4, 8) === "ftyp";
  if (mime === "video/webm" || mime === "audio/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === "audio/ogg") return ascii.startsWith("OggS");
  if (mime === "audio/wav") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
  if (mime === "audio/mpeg") return ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  return true;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "media";
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "media";
}

function cloudinaryRef(id: string) {
  return `cloudinary:${id}`;
}

async function signedDeliveryUrl(asset: Record<string, unknown>) {
  return await signedAuthenticatedDeliveryUrl({
    cloudName: env("CLOUDINARY_CLOUD_NAME"),
    apiSecret: env("CLOUDINARY_API_SECRET"),
    publicId: String(asset.public_id),
    resourceType: String(asset.resource_type),
    version: Number(asset.version),
    format: asset.format ? String(asset.format) : null,
  });
}

async function signUpload(params: Record<string, string>) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return await sha256(`${serialized}${env("CLOUDINARY_API_SECRET")}`);
}

async function authenticate(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workerToken = request.headers.get("X-Worker-Token");
  const expectedWorkerToken = Deno.env.get("GMAIL_WORKER_TOKEN")?.trim();
  if (workerToken && expectedWorkerToken && secureEqual(workerToken, expectedWorkerToken)) {
    return {
      worker: true,
      userId: null as string | null,
      accessToken: null as string | null,
      profile: null as Record<string, unknown> | null,
    };
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  const { data: profileRaw, error: profileError } = await admin.from("profiles")
    .select("id,company_id,role,status").eq("id", authData.user.id).maybeSingle();
  const profile = profileRaw as {
    id: string;
    company_id: string;
    role: string;
    status: string;
  } | null;
  if (profileError || !profile || profile.status !== "active") {
    throw new Response(JSON.stringify({ error: "Active profile required" }), { status: 403 });
  }
  return { worker: false, userId: authData.user.id, accessToken: token, profile };
}

async function uploadToCloudinary(file: File, folder: string, publicId: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    folder,
    public_id: publicId,
    timestamp,
    type: "authenticated",
  };
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("api_key", env("CLOUDINARY_API_KEY"));
  form.set("timestamp", timestamp);
  form.set("folder", folder);
  form.set("public_id", publicId);
  form.set("type", "authenticated");
  form.set("signature_algorithm", "sha256");
  form.set("signature", await signUpload(params));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(env("CLOUDINARY_CLOUD_NAME"))}/auto/upload`,
    { method: "POST", body: form },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Cloudinary upload failed (${response.status})`);
  return payload;
}

async function destroyCloudinary(asset: Record<string, unknown>) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    invalidate: "true",
    public_id: String(asset.public_id),
    timestamp,
    type: "authenticated",
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", env("CLOUDINARY_API_KEY"));
  form.set("signature_algorithm", "sha256");
  form.set("signature", await signUpload(params));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(env("CLOUDINARY_CLOUD_NAME"))}/${encodeURIComponent(String(asset.resource_type))}/destroy`,
    { method: "POST", body: form },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !["ok", "not found"].includes(payload.result)) {
    throw new Error(payload?.error?.message || `Cloudinary delete failed (${response.status})`);
  }
}

Deno.serve((request) => withCors(request, async () => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const supabaseUrl = env("SUPABASE_URL");
    const publicKey = env("SUPABASE_ANON_KEY");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = await authenticate(request, supabaseUrl, serviceRoleKey);
    const limit = await checkDistributedRateLimit(admin, "cloudinary-media", auth.worker ? "gmail-worker" : String(auth.userId), {
      limit: auth.worker ? 300 : 180,
      windowMs: 60_000,
      supabaseUrl,
    });
    if (!limit.allowed) return rateLimitResponse(limit);
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const scope = String(form.get("scope") || "");
      const contextId = String(form.get("contextId") || "") || null;
      const workerCompanyId = String(form.get("companyId") || "") || null;
      if (!(file instanceof File) || file.size < 1) return json({ error: "File is required" }, 400);
      if (file.size > MAX_BYTES) return json({ error: "File exceeds the 50 MB limit" }, 413);
      if (!allowedScopes.has(scope)) return json({ error: "Unsupported media scope" }, 422);
      if (!(scopeTypes[scope] || []).some((pattern) => pattern.test(file.type || "application/octet-stream"))) {
        return json({ error: "Unsupported media type" }, 415);
      }
      if (!await matchesMagic(file)) return json({ error: "File content does not match its media type" }, 415);
      const companyId = auth.worker ? workerCompanyId : String(auth.profile?.company_id || "");
      if (!companyId) return json({ error: "Company is required" }, 422);
      if (auth.worker && !["broker_original", "gmail_raw"].includes(scope)) {
        return json({ error: "Worker may upload only Gmail media" }, 403);
      }
      if (!auth.worker) {
        if (["broker_original", "gmail_raw"].includes(scope)) {
          return json({ error: "This media scope is worker-only" }, 403);
        }
        if (!contextId) return json({ error: "Media context is required" }, 422);
        const caller = createClient(supabaseUrl, publicKey, {
          global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
        });
        if (scope === "chat") {
          const { data: allowed } = await caller.rpc("can_access_chat_conversation", {
            target_conversation_id: contextId,
          });
          if (!allowed) return json({ error: "Chat media access denied" }, 403);
        } else if (scope === "load_document") {
          const { data: allowed } = await caller.rpc(
            "can_access_load_media_context",
            { target_context_id: contextId },
          );
          if (!allowed) return json({ error: "Load media access denied" }, 403);
        } else if (["profile_avatar", "driver_document"].includes(scope)) {
          if (contextId !== auth.userId) return json({ error: "Profile media access denied" }, 403);
        } else if (scope === "manual_import" && !["company_admin", "dispatcher"].includes(String(auth.profile?.role))) {
          return json({ error: "Dispatcher permission required" }, 403);
        }
      }
      const id = crypto.randomUUID();
      const folder = `drivex/${safeSegment(companyId)}/${safeSegment(scope)}`;
      const publicId = `${contextId ? `${safeSegment(contextId)}-` : ""}${id}-${safeFileName(file.name).replace(/\.[^.]+$/, "")}`;
      const uploaded = await uploadToCloudinary(file, folder, publicId);
      const { data: asset, error: assetError } = await admin.from("media_assets").insert({
        id,
        company_id: companyId,
        uploaded_by: auth.userId,
        scope,
        context_id: contextId,
        cloudinary_asset_id: uploaded.asset_id,
        public_id: uploaded.public_id,
        resource_type: uploaded.resource_type,
        delivery_type: "authenticated",
        version: uploaded.version,
        format: uploaded.format || null,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: uploaded.bytes || file.size,
      }).select("*").single();
      if (assetError) {
        await destroyCloudinary(uploaded).catch(() => undefined);
        return json({ error: assetError.message }, 500);
      }
      return json({
        reference: cloudinaryRef(asset.id),
        assetId: asset.id,
        fileName: asset.file_name,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
        resourceType: asset.resource_type,
      }, 201);
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "signedUrl");
    const reference = String(body.reference || "");
    const assetId = reference.startsWith("cloudinary:") ? reference.slice(11) : reference;
    if (!assetId) return json({ error: "Media reference is required" }, 400);
    const mediaReader = auth.worker
      ? admin
      : createClient(supabaseUrl, publicKey, {
        global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
      });
    const query = mediaReader.from("media_assets").select("*").eq("id", assetId).is("deleted_at", null);
    const { data: asset, error: assetError } = await query.maybeSingle();
    if (assetError || !asset) return json({ error: "Media not found" }, 404);
    if (action === "signedUrl") {
      const url = await signedDeliveryUrl(asset);
      return json({
        url,
        expiresAt: null,
        expirationEnforced: false,
      });
    }
    if (action === "delete") {
      if (auth.worker) return json({ error: "Worker cannot delete media" }, 403);
      if (!canDeleteMedia(auth, asset)) {
        return json({ error: "Media delete permission denied" }, 403);
      }
      await destroyCloudinary(asset);
      const { error: deleteError } = await admin.from("media_assets")
        .update({ deleted_at: new Date().toISOString() }).eq("id", asset.id);
      if (deleteError) return json({ error: "Media deletion could not be recorded. Please retry." }, 500);
      return json({ deleted: true });
    }
    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return json({ error: error instanceof Error ? error.message : "Cloudinary media request failed" }, 500);
  }
}));
