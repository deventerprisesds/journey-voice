// WHAT:       GET/POST app-downloads -> the newest TaskOS and Huddle phone builds, each with a fresh download
//             link, for the Settings "Download" tab.
// WHY:        See ../_shared/app-downloads.ts. Signed-in users only (the anon key alone is refused); the
//             bridge-builder call carries the shared JOURNEY_PROXY_TOKEN, never sent to the browser.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   deventerprisesds/bridge-builder#2.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/config.ts";
import { DEFAULT_BRIDGE_BUILDER_API_URL, DOWNLOAD_APPS, shapeDownloads } from "../_shared/app-downloads.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
  const { data: who } = await supabase.auth.getUser(jwt);
  if (!who?.user) return json({ ok: false, reason: "sign_in_required" }, 401);

  const token = Deno.env.get("JOURNEY_PROXY_TOKEN");
  if (!token) return json({ ok: false, reason: "not_configured" }, 503);
  const base = (Deno.env.get("BRIDGE_BUILDER_API_URL") || DEFAULT_BRIDGE_BUILDER_API_URL).replace(/\/+$/, "");
  const ids = DOWNLOAD_APPS.map((a) => a.appId).join(",");

  try {
    const r = await fetch(`${base}/api/getLatestApk?appId=${ids}`, {
      headers: { "x-journey-proxy-token": token },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error("[app-downloads] bridge-builder", r.status);
      return json({ ok: false, reason: `bridge_${r.status}` }, 502);
    }
    const body = await r.json();
    return json({ ok: true, apps: shapeDownloads(body?.apps) });
  } catch (e) {
    console.error("[app-downloads] fetch failed:", e instanceof Error ? e.message : e);
    return json({ ok: false, reason: "bridge_unreachable" }, 502);
  }
});
