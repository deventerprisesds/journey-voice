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
//   { op: "set_status", token, status: "DOING"|"DONE"|"BACKLOG"|"PARK", requestId?, attempt?, tapAt? }
//     BACKLOG = off the calendar now (the nightly planner may re-place it later).
//     PARK    = BACKLOG + the "parking-lot" tag: skipped by all automation until un-parked.
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
const STATUSES = new Set(["DOING", "DONE", "BACKLOG", "PARK"]);
const PARKING_LOT_TAG = "parking-lot"; // exact lowercase — every filter (journey builder, Huddle) matches it verbatim

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
        .select("id, status, tags, start_time, is_scheduled")
        .eq("id", claims.taskId)
        .eq("user_id", claims.userId)
        .maybeSingle();
      if (readErr) return json({ ok: false, reason: "db", detail: readErr.message }, 500);

      let matched = 0;
      let changed = false;
      if (task) {
        matched = 1;
        const unscheduling = status === "BACKLOG" || status === "PARK";
        const tags: string[] = Array.isArray(task.tags) ? task.tags : [];
        const alreadyThere = unscheduling
          ? task.status === "BACKLOG" && !task.start_time && !task.is_scheduled &&
            (status !== "PARK" || tags.includes(PARKING_LOT_TAG))
          : task.status === status;
        if (!alreadyThere) {
          const now = new Date().toISOString();
          // Same fields the web app writes (FocusView handleCompleteTask / handleStartTask). DONE
          // must set completed_at: the schedule_task_reminders trigger keys on it to delete the
          // task's pending reminders, which is what stops tomorrow's repeat alarm.
          const update: Record<string, unknown> = { status: unscheduling ? "BACKLOG" : status, updated_at: now };
          if (status === "DONE") update.completed_at = now;
          if (unscheduling) {
            // Off the calendar, like execute-tool unschedule_task. Tags are REPLACED by writes, so
            // PARK writes the union (same rule as Huddle's withParkingLotTag).
            Object.assign(update, { start_time: null, end_time: null, is_scheduled: false });
            if (status === "PARK" && !tags.includes(PARKING_LOT_TAG)) update.tags = [...tags, PARKING_LOT_TAG];
          }
          const { error: writeErr } = await supabase
            .from("tasks")
            .update(update)
            .eq("id", claims.taskId)
            .eq("user_id", claims.userId);
          if (writeErr) return json({ ok: false, reason: "db", detail: writeErr.message }, 500);
          changed = true;
        }
        if (unscheduling) {
          // Cancel everything still queued for it (the 2nd start alarm, due reminders). The trigger
          // also drops start alarms when start_time is cleared; this covers the rest explicitly.
          await supabase.from("scheduled_notifications").delete()
            .eq("task_id", claims.taskId)
            .neq("notification_type", "task_created")
            .is("delivered_at", null).is("failed_at", null);
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
