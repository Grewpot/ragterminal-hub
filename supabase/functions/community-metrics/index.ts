import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const MAX_IDS = 100;
const MAX_BODY_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAllowedOrigin(origin: string | null): boolean {
  return !origin ||
    origin === "https://ragterminal-hub.vercel.app" ||
    origin === "https://ragterminal-hub-grewpots-projects.vercel.app" ||
    /^https:\/\/ragterminal-hub-[a-z0-9-]+-grewpots-projects\.vercel\.app$/.test(origin);
}

function corsHeaders(origin: string | null, cacheControl: string) {
  const allowedOrigin = isAllowedOrigin(origin) && origin
    ? origin
    : "https://ragterminal-hub.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": cacheControl,
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  const cache = status === 200 ? "public, max-age=30, stale-while-revalidate=30" : "no-store";
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, cache), "Content-Type": "application/json" },
  });
}

function createAdminClient() {
  const secrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  let secretKey = "";
  if (secrets) {
    try {
      const parsed = JSON.parse(secrets);
      if (typeof parsed.default === "string") secretKey = parsed.default;
    } catch { /* use legacy key below */ }
  }
  const legacyServiceRoleJwt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = secretKey || legacyServiceRoleJwt;
  if (!apiKey) throw new Error("Server secret is not configured.");
  return createClient(SUPABASE_URL, apiKey, {
    global: {
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("apikey", apiKey);
        if (legacyServiceRoleJwt) headers.set("Authorization", "Bearer " + legacyServiceRoleJwt);
        else headers.delete("Authorization");
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin, "no-store") });
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);
  if (!isAllowedOrigin(origin)) return json({ error: "Origin is not allowed." }, 403, origin);

  try {
    const declaredLength = Number(req.headers.get("Content-Length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large." }, 413, origin);
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large." }, 413, origin);
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Valid JSON is required." }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "A JSON object body is required." }, 400, origin);
    }

    const value = (body as Record<string, unknown>).artifact_ids;
    if (!Array.isArray(value) || value.length > MAX_IDS) {
      return json({ error: "artifact_ids must be an array containing at most 100 UUIDs." }, 400, origin);
    }
    if (!value.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      return json({ error: "Every artifact_id must be a UUID." }, 400, origin);
    }
    const ids = [...new Set(value as string[])];
    if (!ids.length) return json({ ok: true, items: [] }, 200, origin);

    // Only aggregate counts for published assets with a public parent repository are
    // returned. User identifiers and individual star/download rows never leave Postgres.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("community_public_metrics", { p_artifact_ids: ids });
    if (error) {
      console.error("Public community metrics query failed", error.message);
      return json({ error: "Community metrics are temporarily unavailable." }, 503, origin);
    }
    return json({ ok: true, items: data || [] }, 200, origin);
  } catch (error) {
    console.error("Community metrics request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Community metrics are temporarily unavailable." }, 503, origin);
  }
});
