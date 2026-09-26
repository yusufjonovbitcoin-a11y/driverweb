import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

type CloudflareIceServer = {
  urls?: string | string[];
  username?: string;
  credential?: string;
};

function normalizeIceServers(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cloudflare TURN returned an invalid response");
  }
  const rawServers = (payload as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(rawServers)) {
    throw new Error("Cloudflare TURN returned no ICE servers");
  }

  const stunUrls = new Set<string>();
  const turnUrls = new Set<string>();
  let username = "";
  let credential = "";

  for (const rawServer of rawServers) {
    if (!rawServer || typeof rawServer !== "object") continue;
    const server = rawServer as CloudflareIceServer;
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const url of urls) {
      if (typeof url !== "string") continue;
      if (/^stun:/i.test(url)) stunUrls.add(url);
      if (/^turns?:/i.test(url)) turnUrls.add(url);
    }
    if (turnUrls.size && server.username && server.credential) {
      username = server.username;
      credential = server.credential;
    }
  }

  if (!turnUrls.size || !username || !credential) {
    throw new Error("Cloudflare TURN returned incomplete credentials");
  }
  if (!stunUrls.size) stunUrls.add("stun:stun.cloudflare.com:3478");

  return [
    { urls: [...stunUrls] },
    { urls: [...turnUrls], username, credential },
  ];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);
    const admin = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(
      token,
    );
    if (authError || !authData.user) {
      return json({ error: "Invalid session" }, 401);
    }
    const { data: profile } = await admin.from("profiles")
      .select("id,status").eq("id", authData.user.id).maybeSingle();
    if (!profile || profile.status !== "active") {
      return json({ error: "Active profile required" }, 403);
    }

    const ttlSeconds = 3600;
    const keyId = encodeURIComponent(env("CLOUDFLARE_TURN_KEY_ID"));
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env("CLOUDFLARE_TURN_KEY_API_TOKEN")}`,
          "Content-Type": "application/json",
          "User-Agent": "driverweb-turn-credentials/1.0",
        },
        body: JSON.stringify({ ttl: ttlSeconds }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Cloudflare TURN credential request failed (${response.status})`,
      );
    }
    const iceServers = normalizeIceServers(await response.json());
    return json({
      iceServers,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : "TURN credential request failed",
    }, 500);
  }
});
