const DEFAULT_ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-worker-token";

function configuredOrigins() {
  let configured = "";
  try {
    configured = Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "";
  } catch {
    // Tests and restricted runtimes may intentionally omit environment access.
  }
  return new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function allowedCorsOrigin(origin: string | null) {
  if (!origin) return null;
  if (isLocalDevelopmentOrigin(origin)) return origin;
  return configuredOrigins().has(origin) ? origin : null;
}

function appendVary(headers: Headers, value: string) {
  const current = headers.get("Vary")?.split(",").map((item) => item.trim()) ??
    [];
  if (!current.includes(value)) {
    headers.set("Vary", [...current, value].filter(Boolean).join(", "));
  }
}

function applyCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  appendVary(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function withCors(
  request: Request,
  handler: () => Response | Promise<Response>,
) {
  const requestedOrigin = request.headers.get("Origin");
  const origin = allowedCorsOrigin(requestedOrigin);
  if (request.method === "OPTIONS") {
    if (requestedOrigin && !origin) {
      return new Response("CORS origin denied", {
        status: 403,
        headers: { "Vary": "Origin" },
      });
    }
    const headers = new Headers({
      "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    });
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return new Response("ok", { headers });
  }

  if (requestedOrigin && !origin) {
    return new Response("CORS origin denied", {
      status: 403,
      headers: { "Vary": "Origin" },
    });
  }

  const response = await handler();
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  const sanitized = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return origin ? applyCors(sanitized, origin) : sanitized;
}
