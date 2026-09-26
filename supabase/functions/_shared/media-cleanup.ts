export type MediaCleanupPayload = {
  provider: "cloudinary" | "supabase_storage";
  documentVersionId: string;
  mediaRef?: string;
  mediaAssetId?: string | null;
  assetId?: string | null;
  publicId?: string;
  resourceType?: "image" | "video" | "raw";
  deliveryType?: "authenticated";
  bucket?: "load-documents";
  storagePath?: string;
};

export class MediaCleanupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MediaCleanupError";
  }
}

function requiredString(value: unknown, field: string, maxLength = 1024) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new MediaCleanupError(`Invalid ${field}`, false);
  }
  return value;
}

export function parseMediaCleanupPayload(value: unknown): MediaCleanupPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCleanupError("Invalid media cleanup payload", false);
  }
  const payload = value as Record<string, unknown>;
  const provider = requiredString(payload.provider, "provider", 40);
  const documentVersionId = requiredString(
    payload.documentVersionId,
    "documentVersionId",
    100,
  );

  if (provider === "cloudinary") {
    const resourceType = requiredString(
      payload.resourceType,
      "resourceType",
      20,
    );
    const deliveryType = requiredString(
      payload.deliveryType,
      "deliveryType",
      30,
    );
    if (!["image", "video", "raw"].includes(resourceType)) {
      throw new MediaCleanupError(
        "Unsupported Cloudinary resource type",
        false,
      );
    }
    if (deliveryType !== "authenticated") {
      throw new MediaCleanupError(
        "Unsupported Cloudinary delivery type",
        false,
      );
    }
    return {
      provider,
      documentVersionId,
      mediaRef: requiredString(payload.mediaRef, "mediaRef", 120),
      mediaAssetId: typeof payload.mediaAssetId === "string"
        ? requiredString(payload.mediaAssetId, "mediaAssetId", 100)
        : null,
      assetId: typeof payload.assetId === "string" ? payload.assetId : null,
      publicId: requiredString(payload.publicId, "publicId", 500),
      resourceType: resourceType as "image" | "video" | "raw",
      deliveryType,
    };
  }

  if (provider === "supabase_storage") {
    const bucket = requiredString(payload.bucket, "bucket", 100);
    const storagePath = requiredString(payload.storagePath, "storagePath");
    if (bucket !== "load-documents") {
      throw new MediaCleanupError("Unsupported storage bucket", false);
    }
    if (storagePath.includes("\0") || storagePath.split("/").includes("..")) {
      throw new MediaCleanupError("Unsafe storage path", false);
    }
    return {
      provider,
      documentVersionId,
      bucket,
      storagePath,
    };
  }

  throw new MediaCleanupError("Unsupported media provider", false);
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string) {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function cloudinarySignature(
  params: Record<string, string>,
  apiSecret: string,
) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return sha256(`${serialized}${apiSecret}`);
}

export async function deleteCloudinaryMedia(
  payload: MediaCleanupPayload,
  config: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
) {
  if (payload.provider !== "cloudinary") {
    throw new MediaCleanupError("Cloudinary payload required", false);
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    invalidate: "true",
    public_id: String(payload.publicId),
    timestamp,
    type: String(payload.deliveryType),
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", config.apiKey);
  form.set("signature_algorithm", "sha256");
  form.set("signature", await cloudinarySignature(params, config.apiSecret));

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(config.timeoutMs ?? 10_000, 1_000), 30_000),
  );
  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(
      `https://api.cloudinary.com/v1_1/${
        encodeURIComponent(config.cloudName)
      }/${encodeURIComponent(String(payload.resourceType))}/destroy`,
      { method: "POST", body: form, signal: controller.signal },
    );
  } catch (error) {
    throw new MediaCleanupError(
      error instanceof DOMException && error.name === "AbortError"
        ? "Cloudinary delete timed out"
        : "Cloudinary delete request failed",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
  const result = await response.json().catch(() => ({}));
  if (response.ok && ["ok", "not found"].includes(String(result?.result))) {
    return;
  }
  const retryable = response.status === 429 || response.status >= 500;
  const detail = typeof result?.error?.message === "string"
    ? result.error.message
    : `Cloudinary delete failed (${response.status})`;
  throw new MediaCleanupError(detail, retryable);
}
