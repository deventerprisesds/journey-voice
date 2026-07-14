// drain-huddle-turns — the always-on heartbeat that makes Huddle chat replies device-independent.
//
// A Huddle chat turn is persisted server-side and normally runs in the user's own request. But if
// that request dies (phone backgrounded, screen off, app closed) mid-turn, the turn is left queued
// or stale-running. This function — pinged every minute by pg_cron — POSTs to Huddle's
// /api/public/run-turn drain endpoint, which finishes any such turn to completion and fires a Web
// Push notification. journey is always-on, so this guarantees a turn never strands on a sleeping
// device. Auth reuses the shared JOURNEY_PROXY_TOKEN (kept in edge secrets, never in the DB), same
// as run-scheduled-ceremonies / huddle-task-sync — no new secret.
//
// Runs the work under EdgeRuntime.waitUntil so pg_net's short timeout can't abort a slow drain.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TOKEN = (Deno.env.get("JOURNEY_PROXY_TOKEN") ?? "").trim();
const RUN_TURN_URL = (
  Deno.env.get("HUDDLE_RUN_TURN_URL") ??
  "https://icy-flower-0f415200f.7.azurestaticapps.net/api/public/run-turn"
).trim();

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(() => {
  const work = (async () => {
    if (!TOKEN) return { ok: false, error: "JOURNEY_PROXY_TOKEN not set" };
    try {
      // Empty-ish body = "drain queued". Huddle runs up to `max` queued/stale turns this tick.
      const res = await fetch(RUN_TURN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": TOKEN },
        body: JSON.stringify({ max: 10 }),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })();

  try {
    EdgeRuntime.waitUntil(work);
  } catch (_) {
    /* local dev */
  }
  return work.then((r) => json(r)).catch((e) => json({ ok: false, error: String(e) }, 500));
});
