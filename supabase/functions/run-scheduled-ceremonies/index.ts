// run-scheduled-ceremonies — fires due scrum-ceremony "virtual meetings" on cadence.
//
// Reads the DEDICATED public.ceremony_occurrences queue (isolated from scheduled_notifications,
// which a general every-minute delivery job consumes). For each due occurrence:
//  - auto_run  → POST Huddle /api/public/run-ceremony (runs unattended, transcript persisted for
//                later review), auth via the shared JOURNEY_PROXY_TOKEN.
//  - reminder  → drop a ceremony_reminder into scheduled_notifications (the general delivery job
//                surfaces it to the user).
// Then reschedule the NEXT occurrence. Claims rows atomically (status pending→processing) so a
// second tick can't double-fire, and runs under EdgeRuntime.waitUntil so an early disconnect
// (short pg_net timeout) can't abort a slow ceremony.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("JOURNEY_PROXY_TOKEN") ?? "").trim();
const RUN_CEREMONY_URL = (
  Deno.env.get("HUDDLE_RUN_CEREMONY_URL") ??
  "https://icy-flower-0f415200f.7.azurestaticapps.net/api/public/run-ceremony"
).trim();

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(() => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  const work = (async () => {
    const { data: claimed, error } = await supabase
      .from("ceremony_occurrences")
      .update({ status: "processing" })
      .eq("status", "pending")
      .lte("scheduled_for", nowIso)
      .select("*");

    if (error) return { ok: false, error: error.message };

    let fired = 0, reminded = 0, failed = 0;

    for (const o of claimed ?? []) {
      const ceremonyType = String(o.ceremony_type ?? "standup");
      const mode = String(o.mode ?? "round-robin");
      const autoRun = o.auto_run === true;
      const tz = String(o.timezone ?? "America/New_York");
      const daysOfWeek = Array.isArray(o.days_of_week) ? (o.days_of_week as number[]) : null;

      let email: string | null = null;
      try {
        const { data: prof } = await supabase.from("profiles").select("email").eq("user_id", o.user_id).limit(1).maybeSingle();
        email = (prof?.email as string | undefined) ?? null;
      } catch (_) { /* best effort */ }

      let finalStatus: "fired" | "reminded" | "failed" = "failed";

      if (email && autoRun) {
        try {
          const res = await fetch(RUN_CEREMONY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-webhook-secret": TOKEN },
            body: JSON.stringify({ ceremonyType, caller: { entra_email: email }, mode, autoRun: true, timeZone: tz, runId: o.id }),
          });
          if (res.ok) { finalStatus = "fired"; fired++; }
          else { finalStatus = "failed"; failed++; }
        } catch (_) { finalStatus = "failed"; failed++; }
      } else if (email) {
        try {
          await supabase.from("scheduled_notifications").insert({
            user_id: o.user_id,
            notification_type: "ceremony_reminder",
            title: `Time for your ${ceremonyType.replace("_", " ")}`,
            body: JSON.stringify({ ceremony_type: ceremonyType, mode, occurrence_id: o.id }),
            scheduled_for: nowIso,
          });
          finalStatus = "reminded"; reminded++;
        } catch (_) { finalStatus = "failed"; failed++; }
      }

      await supabase.from("ceremony_occurrences").update({ status: finalStatus }).eq("id", o.id);

      try {
        await supabase.rpc("schedule_next_ceremony", {
          p_user_id: o.user_id,
          p_ceremony_id: String(o.ceremony_id ?? ceremonyType),
          p_ceremony_type: ceremonyType,
          p_time: String(o.ceremony_time ?? "12:00"),
          p_mode: mode,
          p_auto_run: autoRun,
          p_timezone: tz,
          p_days_of_week: daysOfWeek,
        });
      } catch (_) { /* re-materialized on next schedule edit */ }
    }

    return { ok: true, considered: (claimed ?? []).length, fired, reminded, failed };
  })();

  try { EdgeRuntime.waitUntil(work); } catch (_) { /* local dev */ }
  return work.then((r) => json(r)).catch((e) => json({ ok: false, error: String(e) }, 500));
});
