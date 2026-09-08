import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// External-meeting confirmation + slot release.
//
// The morning review asks "are you attending <meeting>?". This function records that
// decision. On DECLINE / NO-SHOW it RELEASES the freed window: it finds the next
// unscheduled task of the meeting's category that fits the freed time and schedules it
// into the exact slot the meeting occupied — so a declined meeting doesn't waste the
// block. ATTENDING just records the confirmation (the hold stands).
//
// Request: { user_id, external_event_id, decision: 'attending'|'declined'|'no_show',
//            category? }  (category overrides the stored/default CAREER when known)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { user_id, external_event_id, decision, category: categoryOverride } = await req.json();

    if (!user_id || !external_event_id || !decision) {
      return json({ error: 'user_id, external_event_id and decision are required' }, 400);
    }
    if (!['attending', 'declined', 'no_show'].includes(decision)) {
      return json({ error: `invalid decision "${decision}"` }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up the meeting (latest event row for this external id).
    const { data: evt } = await supabase
      .from('external_calendar_events')
      .select('external_event_id, title, start_time, end_time')
      .eq('user_id', user_id)
      .eq('external_event_id', external_event_id)
      .order('last_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const category = (categoryOverride || 'CAREER').toUpperCase();
    const nowIso = new Date().toISOString();

    // Record the decision (idempotent on (user_id, external_event_id)).
    const attendanceRow: Record<string, unknown> = {
      user_id,
      external_event_id,
      event_title: evt?.title ?? null,
      event_start: evt?.start_time ?? null,
      event_end: evt?.end_time ?? null,
      category,
      status: decision,
      decided_at: nowIso,
    };
    const { error: upErr } = await supabase
      .from('external_event_attendance')
      .upsert(attendanceRow, { onConflict: 'user_id,external_event_id' });
    if (upErr) return json({ error: `attendance upsert failed: ${upErr.message}` }, 500);

    // ATTENDING → nothing to release.
    if (decision === 'attending') {
      return json({ ok: true, decision, released: false });
    }

    // DECLINE / NO-SHOW → release the freed window to the next same-category task.
    if (!evt?.start_time || !evt?.end_time) {
      return json({ ok: true, decision, released: false, note: 'no event time available to release' });
    }

    // Idempotency: if we already released this meeting, don't double-fill.
    const { data: existing } = await supabase
      .from('external_event_attendance')
      .select('released, backfill_task_id')
      .eq('user_id', user_id)
      .eq('external_event_id', external_event_id)
      .maybeSingle();
    if (existing?.released && existing.backfill_task_id) {
      return json({ ok: true, decision, released: true, backfillTaskId: existing.backfill_task_id, note: 'already released' });
    }

    const slotStart = new Date(evt.start_time);
    const slotEnd = new Date(evt.end_time);
    const windowMinutes = Math.max(0, (slotEnd.getTime() - slotStart.getTime()) / 60000);

    // Next unscheduled same-category task that FITS the freed window, best-first
    // (explicit priority, then priority rank, then due date). We keep the DB filter
    // broad and rank in code so the ordering matches the builder's intent.
    const { data: candidates } = await supabase
      .from('tasks')
      .select('id, title, category, priority, estimate_minutes, due_date, is_priority, priority_rank, created_at')
      .eq('user_id', user_id)
      .eq('category', category)
      .eq('is_scheduled', false)
      .is('completed_at', null)
      .not('status', 'in', '("DONE","BLOCKED")')
      .limit(50);

    const fits = (candidates || [])
      .map((t: any) => ({ ...t, _dur: t.estimate_minutes || 60 }))
      .filter((t: any) => t._dur <= windowMinutes || windowMinutes === 0)
      .sort((a: any, b: any) => {
        const ap = a.is_priority ? 1 : 0, bp = b.is_priority ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (ap && bp) {
          const ar = a.priority_rank ?? 9999, br = b.priority_rank ?? 9999;
          if (ar !== br) return ar - br;
        }
        const rank: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        const rp = (rank[b.priority] || 0) - (rank[a.priority] || 0);
        if (rp !== 0) return rp;
        if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

    const pick = fits[0];
    if (!pick) {
      // Nothing to backfill — still mark the meeting released so we don't re-scan it.
      await supabase
        .from('external_event_attendance')
        .update({ released: true })
        .eq('user_id', user_id)
        .eq('external_event_id', external_event_id);
      return json({ ok: true, decision, released: true, backfillTaskId: null, note: `no unscheduled ${category} task fits the freed ${windowMinutes}m window` });
    }

    // Place the backfill task into the exact freed slot (duration = task estimate,
    // capped to the freed window).
    const placeEnd = new Date(slotStart.getTime() + Math.min(pick._dur, windowMinutes || pick._dur) * 60000);
    const { error: schedErr } = await supabase
      .from('tasks')
      .update({
        start_time: slotStart.toISOString(),
        end_time: placeEnd.toISOString(),
        is_scheduled: true,
        status: 'TODO',
        scheduling_context: { pre_schedule_status: pick.status || 'TODO', backfilled_from_meeting: external_event_id },
        updated_at: nowIso,
      })
      .eq('id', pick.id);
    if (schedErr) return json({ error: `backfill schedule failed: ${schedErr.message}` }, 500);

    await supabase
      .from('external_event_attendance')
      .update({ released: true, backfill_task_id: pick.id })
      .eq('user_id', user_id)
      .eq('external_event_id', external_event_id);

    return json({
      ok: true,
      decision,
      released: true,
      freedWindowMinutes: windowMinutes,
      backfillTaskId: pick.id,
      backfillTaskTitle: pick.title,
      scheduledStart: slotStart.toISOString(),
      scheduledEnd: placeEnd.toISOString(),
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
