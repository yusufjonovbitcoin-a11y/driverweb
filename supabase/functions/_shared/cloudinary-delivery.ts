function encodePublicId(publicId: string) {
  return publicId.split("/").map(encodeURIComponent).join("/");
}

// Cloudinary's Upload API download endpoint enforces expires_at. CDN path
// signatures alone do not expire. Only server-owned asset identifiers are used.
export async function temporaryAuthenticatedDownloadUrl({cloudName, apiKey,
  apiSecret, publicId, resourceType, format, expiresAt, timestamp = Math.floor(Date.now()/1000)}: {
  cloudName: string; apiKey: string; apiSecret: string; publicId: string;
  resourceType: string; format?: string | null; expiresAt: number; timestamp?: number;
}) {
  if (!['raw','image','video'].includes(resourceType) || !Number.isInteger(expiresAt) || expiresAt <= timestamp) {
    throw new Error('Invalid temporary media download');
  }
  const params: Record<string,string> = {timestamp: String(timestamp), public_id: publicId,
    type: 'authenticated', attachment: 'false', expires_at: String(expiresAt)};
  // Raw public IDs already include their extension.
  if (format && resourceType !== 'raw') params.format = format;
  const source = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source+apiSecret));
  params.signature = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  params.api_key = apiKey;
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/download?${new URLSearchParams(params)}`;
}

async function sha1Base64Url(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function signedAuthenticatedDeliveryUrl({
  cloudName,
  apiSecret,
  publicId,
  resourceType,
  version,
  format,
}: {
  cloudName: string;
  apiSecret: string;
  publicId: string;
  resourceType: string;
  version: number;
  format?: string | null;
}) {
  const suffix = format ? `.${format}` : "";
  const path = `v${version}/${publicId}${suffix}`;
  const signature = (await sha1Base64Url(`${path}${apiSecret}`)).slice(0, 8);
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resourceType}/authenticated/s--${signature}--/v${version}/${encodePublicId(publicId)}${suffix}`;
}
