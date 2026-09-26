export function isCloudinaryReference(value: string | null | undefined) {
  return Boolean(value?.startsWith("cloudinary:"));
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

export async function downloadPrivateMedia({
  admin,
  bucket,
  reference,
  supabaseUrl,
  serviceRoleKey,
}: {
  admin: StorageClient;
  bucket: string;
  reference: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  if (!isCloudinaryReference(reference)) {
    const { data, error } = await admin.storage.from(bucket).download(reference);
    if (error || !data) throw new Error(error?.message || "Media was not found");
    return data;
  }
  const workerToken = Deno.env.get("GMAIL_WORKER_TOKEN")?.trim();
  if (!workerToken) throw new Error("GMAIL_WORKER_TOKEN is not configured");
  const response = await fetch(`${supabaseUrl}/functions/v1/cloudinary-media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "X-Worker-Token": workerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "signedUrl", reference, expiresIn: 300 }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || `Cloudinary URL failed (${response.status})`);
  }
  const fileResponse = await fetch(payload.url);
  if (!fileResponse.ok) throw new Error(`Cloudinary download failed (${fileResponse.status})`);
  return fileResponse.blob();
}

export async function uploadPrivateMedia({
  supabaseUrl,
  apiKey,
  authorization,
  workerToken,
  companyId,
  file,
  scope,
  contextId,
}: {
  supabaseUrl: string;
  apiKey: string;
  authorization: string;
  workerToken?: string;
  companyId?: string;
  file: File | Blob;
  scope: string;
  contextId?: string | null;
}) {
  const form = new FormData();
  form.set("file", file, file instanceof File ? file.name : "media");
  form.set("scope", scope);
  if (contextId) form.set("contextId", contextId);
  if (companyId) form.set("companyId", companyId);
  const response = await fetch(`${supabaseUrl}/functions/v1/cloudinary-media`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      apikey: apiKey,
      ...(workerToken ? { "X-Worker-Token": workerToken } : {}),
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.reference) {
    throw new Error(payload.error || `Cloudinary upload failed (${response.status})`);
  }
  return payload as {
    reference: string;
    assetId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
}
