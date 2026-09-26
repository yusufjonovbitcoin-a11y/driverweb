const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type Fetcher = typeof fetch;

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Firebase service account ${field} is missing`);
  }
  return value.trim();
}

export function parseFirebaseServiceAccount(
  raw: string,
): FirebaseServiceAccount {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const projectId = requiredString(value.project_id, "project_id");
  const clientEmail = requiredString(value.client_email, "client_email");
  const privateKey = requiredString(value.private_key, "private_key");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Firebase service account private_key is invalid");
  }
  return { projectId, clientEmail, privateKey };
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/g,
    "",
  );
}

function encodedJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemBytes(pem: string) {
  const body = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  try {
    return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Firebase service account private_key is invalid");
  }
}

async function serviceAccountAssertion(account: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodedJson({ alg: "RS256", typ: "JWT" });
  const claims = encodedJson({
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(account.privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error(
      "Firebase service account private_key could not be imported",
    );
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export async function fetchFirebaseAccessToken(
  account: FirebaseServiceAccount,
  fetcher: Fetcher = fetch,
) {
  const assertion = await serviceAccountAssertion(account);
  const response = await fetcher(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error(`Firebase OAuth failed (${response.status})`);
  }
  return payload.access_token as string;
}

export function buildFcmMessage(
  token: string,
  notification: { title: string; body: string },
  data: Record<string, string>,
) {
  return {
    message: {
      token,
      notification,
      data,
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } },
      webpush: { headers: { Urgency: "high" } },
    },
  };
}

function fcmErrorCode(payload: Record<string, unknown>) {
  const error = payload.error as Record<string, unknown> | undefined;
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    if (detail && typeof detail === "object") {
      const code = (detail as Record<string, unknown>).errorCode;
      if (typeof code === "string") return code;
    }
  }
  return typeof error?.status === "string" ? error.status : "UNKNOWN";
}

export async function sendFcmMessage(
  account: FirebaseServiceAccount,
  accessToken: string,
  token: string,
  notification: { title: string; body: string },
  data: Record<string, string>,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `https://fcm.googleapis.com/v1/projects/${
      encodeURIComponent(account.projectId)
    }/messages:send`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildFcmMessage(token, notification, data)),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => ({})) as Record<
    string,
    unknown
  >;
  const code = fcmErrorCode(payload);
  return {
    ok: response.ok,
    providerMessageId: response.ok && typeof payload.name === "string"
      ? payload.name
      : null,
    invalidToken: code === "UNREGISTERED",
    retryable: response.status === 429 || response.status >= 500 ||
      ["UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED"].includes(code),
    error: response.ok
      ? null
      : `FCM delivery failed (${response.status}, ${code})`,
  };
}
