export function requireCloudinaryTokenKey(value: string | undefined | null) {
  const key = value?.trim() ?? "";
  if (!key) throw new Error("Cloudinary token-auth key is not configured");
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error("Cloudinary token-auth key must contain 64 hexadecimal characters");
  }
  return key;
}
