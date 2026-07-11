// huddle-task-sync — forwards a journey task change to the Huddle app's mirror.
//
// Invoked by the `notify_huddle_task_sync` DB trigger (pg_net) on every task
// INSERT/UPDATE/DELETE. It resolves the owner's email (profiles.email) and POSTs
// the change to Huddle's /api/public/tasks-sync webhook with the shared secret.
//
// The Huddle URL + secret live in Supabase edge secrets (HUDDLE_SYNC_URL,
// TASKS_SYNC_SECRET), synced from the GitHub org secrets by deploy-supabase-functions.yml
// — same "org secrets are the single source of truth" pattern as JOURNEY_PROXY_TOKEN,
// so the value can't drift from Huddle's copy and is never hand-typed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUDDLE_SYNC_URL = (Deno.env.get("HUDDLE_SYNC_URL") ?? "").trim();
const TASKS_SYNC_SECRET = (Deno.env.get("TASKS_SYNC_SECRET") ?? "").trim();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!HUDDLE_SYNC_URL || !TASKS_SYNC_SECRET) {
    // Not configured yet — succeed quietly so the trigger never errors.
    return json({ ok: true, skipped: "not_configured" });
  }

  let payload: { operation?: string; user_id?: string | null; task?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const task = payload.task ?? {};
  const userId = payload.user_id ?? (task.user_id as string | undefined) ?? null;

  // Resolve the owner's email (Huddle scopes by email).
  let userEmail: string | null = null;
  if (userId) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data } = await supabase.from("profiles").select("email").eq("user_id", userId).limit(1).maybeSingle();
      userEmail = (data?.email as string | undefined) ?? null;
    } catch (_) {
      // best-effort; forward without email if lookup fails
    }
  }

  try {
    const res = await fetch(HUDDLE_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": TASKS_SYNC_SECRET },
      body: JSON.stringify({ operation: payload.operation ?? "UPDATE", user_id: userId, user_email: userEmail, task }),
    });
    return json({ ok: res.ok, status: res.status });
  } catch (err) {
    console.error("[huddle-task-sync] forward failed", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "forward_failed" }, 502);
  }
});
