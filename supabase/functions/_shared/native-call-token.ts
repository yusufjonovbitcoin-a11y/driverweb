const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validCallId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid capability");
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export type CallCapability = {
  v: 1;
  scope: "native-call:decline-status";
  call_id: string;
  recipient_id: string;
  device_id: string;
  iat: number;
  exp: number;
};
async function signingKey(secret: string, usages: KeyUsage[]) {
  if (secret.length < 32) {
    throw new Error("Native call capability key unavailable");
  }
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}
export async function createCallCapability(
  secret: string,
  callId: string,
  recipientId: string,
  deviceId: string,
  startedAt: string,
  now = Date.now(),
) {
  const iat = Math.floor(Date.parse(startedAt) / 1000);
  if (
    !validCallId(callId) || !validCallId(recipientId) ||
    !validCallId(deviceId) || !Number.isFinite(iat) || iat > now / 1000 + 5 ||
    iat + 90 <= now / 1000
  ) throw new Error("Call is no longer ringing");
  const claims: CallCapability = {
    v: 1,
    scope: "native-call:decline-status",
    call_id: callId,
    recipient_id: recipientId,
    device_id: deviceId,
    iat,
    exp: iat + 120,
  };
  const body = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    encoder.encode(body),
  );
  return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyCallCapability(
  secret: string,
  token: unknown,
  callId: string,
  now = Date.now(),
): Promise<CallCapability | null> {
  try {
    if (
      typeof token !== "string" || token.length > 1024 || !validCallId(callId)
    ) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || decode(parts[1]).length !== 32) return null;
    if (
      !await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret, ["verify"]),
        decode(parts[1]),
        encoder.encode(parts[0]),
      )
    ) return null;
    const claims = JSON.parse(
      new TextDecoder().decode(decode(parts[0])),
    ) as CallCapability;
    if (
      claims.v !== 1 || claims.scope !== "native-call:decline-status" ||
      claims.call_id !== callId || !validCallId(claims.recipient_id) ||
      !validCallId(claims.device_id) ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.exp - claims.iat !== 120 ||
      claims.iat > now / 1000 + 5 || claims.exp <= now / 1000
    ) return null;
    return claims;
  } catch {
    return null;
  }
}
