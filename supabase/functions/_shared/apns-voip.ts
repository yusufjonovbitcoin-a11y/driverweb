export type ApnsConfiguration = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
};
export type PushResult = {
  ok: boolean;
  providerMessageId: string | null;
  invalidToken: boolean;
  retryable: boolean;
  error: string | null;
};
const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
export function apnsConfiguration(
  values: {
    keyId?: string;
    teamId?: string;
    privateKey?: string;
    bundleId?: string;
  },
): ApnsConfiguration | null {
  if (
    !/^[A-Z0-9]{10}$/.test(values.keyId ?? "") ||
    !/^[A-Z0-9]{10}$/.test(values.teamId ?? "") ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(values.bundleId ?? "") ||
    !(values.privateKey ?? "").includes("BEGIN PRIVATE KEY")
  ) return null;
  return {
    keyId: values.keyId!,
    teamId: values.teamId!,
    privateKey: values.privateKey!.replaceAll("\\n", "\n"),
    bundleId: values.bundleId!,
  };
}
export async function apnsProviderToken(
  config: ApnsConfiguration,
  now = Date.now(),
) {
  const bytes = Uint8Array.from(
    atob(
      config.privateKey.replace(
        /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
        "",
      ),
    ),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const body = `${encode({ alg: "ES256", kid: config.keyId })}.${
    encode({ iss: config.teamId, iat: Math.floor(now / 1000) })
  }`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(body),
    ),
  );
  const signed = btoa(String.fromCharCode(...signature)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
  return `${body}.${signed}`;
}
export async function sendVoipPush(
  config: ApnsConfiguration,
  authorization: string,
  token: string,
  environment: string,
  bundleId: string,
  data: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<PushResult> {
  if (
    !/^[0-9a-f]{64,512}$/i.test(token) ||
    !["sandbox", "production"].includes(environment) ||
    bundleId !== config.bundleId || data.event !== "incoming_call"
  ) {
    return {
      ok: false,
      providerMessageId: null,
      invalidToken: false,
      retryable: false,
      error: "VoIP registration or invitation invalid",
    };
  }
  const host = environment === "sandbox"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  const response = await fetcher(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${authorization}`,
      "apns-topic": `${config.bundleId}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": "0",
      "apns-collapse-id": data.call_id,
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { "content-available": 1 }, ...data }),
    signal: AbortSignal.timeout(4000),
  });
  const body = await response.json().catch(() => ({}));
  const reason =
    typeof body?.reason === "string" && /^[A-Za-z]+$/.test(body.reason)
      ? body.reason
      : "Unknown";
  return {
    ok: response.ok,
    providerMessageId: response.headers.get("apns-id"),
    invalidToken: ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]
      .includes(reason),
    retryable: response.status === 429 || response.status >= 500,
    error: response.ok
      ? null
      : `APNs delivery failed (${response.status}, ${reason})`,
  };
}
