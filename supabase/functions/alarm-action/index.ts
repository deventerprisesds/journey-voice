// alarm-action — lets the Android bridge's full-screen alarm buttons change a task WITHOUT a login.
//
// WHY: Done/Doing on the phone used to PATCH public.tasks with the user's WebView JWT. That JWT
// expires ~1h after the app is dismissed and is blanked on sign-out, so taps failed silently, the
// task stayed open, the 3am builder rolled it forward and the same alarm fired again the next day.
// Every alarm push now carries a signed single-task token (see _shared/action-token.ts, minted in
// send-push-notification); this endpoint accepts that token instead of a JWT.
//
// verify_jwt = false (config.toml): the token IS the auth. It authorises exactly one task for one
// user, only DOING/DONE, for 7 days. Replays are harmless — setting the same status is a no-op.
//
// Ops:
//   { op: "set_status", token, status: "DOING"|"DONE", requestId?, attempt?, tapAt? }
//     200 {ok:true, matched:0|1, changed:boolean}   — matched:0 → task gone / not this user's
//     401 {ok:false, reason:"bad_token"|"expired"}  — phone falls back or shows "couldn't mark"
//     400 bad request · 500 transient (phone retries)
//   { op: "trace", token, lines: [{msg, ts?}] }   — diagnostics while signed out; ≤20 lines
//
// Never log the token.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyActionToken } from "../_shared/action-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRACE_GRACE_SEC = 30 * 24 * 60 * 60;
const MAX_TRACE_LINES = 20;
const MAX_TRACE_CHARS = 500;
const STATUSES = new Set(["DOING", "DONE"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    if (body?.op === "trace") {
      const claims = await verifyActionToken(body.token, { graceSec: TRACE_GRACE_SEC });
      if (!claims) return json({ ok: false, reason: "bad_token" }, 401);
      const lines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_TRACE_LINES) : [];
      const rows = lines
        .map((l: any) => (typeof l === "string" ? { msg: l } : l))
        .filter((l: any) => l && typeof l.msg === "string" && l.msg.length > 0)
        .map((l: any) => ({
          user_id: claims.userId,
          activity_type: "android_alarm_trace",
          status: "started",
          metadata: {
            message: l.msg.slice(0, MAX_TRACE_CHARS),
            ts: typeof l.ts === "number" ? l.ts : null,
            via: "action_token",
            taskId: claims.taskId,
          },
        }));
      if (rows.length) {
        const { error } = await supabase.from("activity_log").insert(rows);
        if (error) return json({ ok: false, reason: "db", detail: error.message }, 500);
      }
      return json({ ok: true, written: rows.length });
    }

    if (body?.op === "set_status") {
      const status = String(body.status ?? "").toUpperCase();
      if (!STATUSES.has(status)) return json({ ok: false, reason: "bad_status" }, 400);

      const claims = await verifyActionToken(body.token);
      if (!claims) {
        // Distinguish expired from forged so the phone can explain itself in the trace.
        const graced = await verifyActionToken(body.token, { graceSec: TRACE_GRACE_SEC });
        return json({ ok: false, reason: graced ? "expired" : "bad_token" }, 401);
      }

      const { data: task, error: readErr } = await supabase
        .from("tasks")
        .select("id, status")
        .eq("id", claims.taskId)
        .eq("user_id", claims.userId)
        .maybeSingle();
      if (readErr) return json({ ok: false, reason: "db", detail: readErr.message }, 500);

      let matched = 0;
      let changed = false;
      if (task) {
        matched = 1;
        if (task.status !== status) {
          const now = new Date().toISOString();
          // Same fields the web app writes (FocusView handleCompleteTask / handleStartTask). DONE
          // must set completed_at: the schedule_task_reminders trigger keys on it to delete the
          // task's pending reminders, which is what stops tomorrow's repeat alarm.
          const update: Record<string, unknown> = { status, updated_at: now };
          if (status === "DONE") update.completed_at = now;
          const { error: writeErr } = await supabase
            .from("tasks")
            .update(update)
            .eq("id", claims.taskId)
            .eq("user_id", claims.userId);
          if (writeErr) return json({ ok: false, reason: "db", detail: writeErr.message }, 500);
          changed = true;
        }
      }

      supabase.from("activity_log").insert({
        user_id: claims.userId,
        activity_type: "android_alarm_action",
        status: matched ? "completed" : "error",
        metadata: {
          taskId: claims.taskId,
          status,
          matched,
          changed,
          requestId: typeof body.requestId === "string" ? body.requestId.slice(0, 64) : null,
          attempt: Number.isFinite(body.attempt) ? body.attempt : null,
          tapAt: Number.isFinite(body.tapAt) ? body.tapAt : null,
        },
      }).then(() => {}, () => {});

      return json({ ok: true, matched, changed });
    }

    return json({ ok: false, reason: "bad_op" }, 400);
  } catch (e) {
    console.error("[alarm-action] error:", e instanceof Error ? e.message : e);
    return json({ ok: false, reason: "internal" }, 500);
  }
});
