function encodePublicId(publicId: string) {
  return publicId.split("/").map(encodeURIComponent).join("/");
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
