// WHAT:       Nightly assignment intake: reads the owner's coursework from Nexus `content.assignments`
//             (read-only, via nexus-hub-api) and creates / refreshes the matching journey tasks.
//             `{ dryRun: true }` returns exactly what it WOULD create, update and flag, writing nothing.
// WHY:        It used to read journey's own `public.assignments`, frozen on 2026-04-06: every night it
//             scanned 469 dead EMBA/MIT rows and created 0 tasks (activity_log 2026-10-28:
//             created 0, skipped 469), so none of the owner's dated DBA deliverables ever reached the
//             board. It also rewrote due dates to the UTC calendar day at 23:59Z (a day late for any
//             evening deadline in ET).
// SUPERSEDES: main 9c81e5f's version of this file (Supabase `public.assignments` reader, MIT_PROGRAM_ID
//             literal, 30-day skip). The decision logic moved to `_shared/assignment-intake.ts`.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §1, §5 P1; build log in the same file.
//
// Triggered by nightly-schedule-builder STEP 0 (cron 05:00 UTC), the FocusView manual button and the
// end of both sheet syncs — all unchanged. Request body: { userId, timezone?, dryRun? }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getTodayInTimezone } from "../_shared/timezone.ts";
import { fetchNexusAssignments, nexusApiBase } from "../_shared/nexus-read.ts";
import {
  planAssignmentSync, buildSyncDigest, describePlan, digestSendAt,
  type ExistingTask, type PlannedCreate, type PlannedUpdate,
} from "../_shared/assignment-intake.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { userId, timezone: tzInput, dryRun: dryRunInput } = await req.json();
    const timezone = tzInput || 'America/New_York';
    const dryRun = dryRunInput === true;
    if (!userId) return json({ error: 'userId required' }, 400);

    const nowISO = new Date().toISOString();
    const todayISO = getTodayInTimezone(timezone);
    console.log(`[ASSIGNMENT_SYNC] user=${userId} tz=${timezone} today=${todayISO} dryRun=${dryRun} nexus=${nexusApiBase()}`);

    // ---- 1. Nexus (read-only). A failed read means: write NOTHING, report failure. ----
    const nexus = await fetchNexusAssignments(userId);
    if (!nexus.ok) {
      console.error(`[ASSIGNMENT_SYNC] Nexus read failed (${nexus.status ?? 'no status'}): ${nexus.error}`);
      if (!dryRun) {
        await supabase.from('activity_log').insert({
          user_id: userId, activity_type: 'nightly_assignment_sync', status: 'failed',
          metadata: { source: 'nexus', error: nexus.error ?? null, http_status: nexus.status ?? null },
        });
      }
      return json({ success: false, dryRun, error: `Nexus read failed: ${nexus.error}` }, 502);
    }

    // ---- 2. Oldest default board (#43: never create one on a failed read) ----
    const { data: boards } = await supabase
      .from('boards').select('id')
      .eq('user_id', userId).eq('is_default', true)
      .order('created_at', { ascending: true }).limit(1);
    const boardId: string | null = boards?.[0]?.id ?? null;

    // ---- 3. Existing tasks (paginated; PostgREST caps a page at 1000) ----
    const tasks: ExistingTask[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error } = await supabase
        .from('tasks')
        .select('id, title, status, completed_at, assignment_id, due_date, tags, scheduling_context')
        .eq('user_id', userId)
        .range(offset, offset + PAGE - 1);
      if (error) {
        // A partial task list could make a linked card look missing and duplicate it. Stop.
        console.error('[ASSIGNMENT_SYNC] Error loading tasks:', error);
        return json({ success: false, dryRun, error: `task read failed: ${error.message}` }, 500);
      }
      if (!page?.length) break;
      tasks.push(...(page as ExistingTask[]));
      if (page.length < PAGE) break;
    }

    // ---- 4. Plan (pure) ----
    const plan = planAssignmentSync({ rows: nexus.rows, tasks, todayISO, timezone, boardId, userId, nowISO });
    console.log(`[ASSIGNMENT_SYNC] nexus_rows=${plan.scanned} current=${plan.currentCourses.join(',') || '-'} ` +
      `creates=${plan.creates.length} updates=${plan.updates.length} done_untouched=${plan.untouchedDone.length} ` +
      `excluded=${JSON.stringify(plan.excluded)}`);
    if (!boardId && plan.excluded.noBoard) {
      console.error(`[ASSIGNMENT_SYNC] No default board for ${userId} — ${plan.excluded.noBoard} assignment(s) could not be created`);
    }

    if (dryRun) {
      return json({ success: true, dryRun: true, today: todayISO, timezone, ...describePlan(plan, timezone) });
    }

    // ---- 5. Apply ----
    const appliedCreates: PlannedCreate[] = [];
    const created: string[] = [];
    const INSERT_CHUNK = 100;
    for (let i = 0; i < plan.creates.length; i += INSERT_CHUNK) {
      const chunk = plan.creates.slice(i, i + INSERT_CHUNK);
      const { data: rows, error } = await supabase.from('tasks').insert(chunk.map((c) => c.insert)).select('id, assignment_id');
      if (error) { console.error(`[ASSIGNMENT_SYNC] insert error (chunk ${i}):`, error); continue; }
      for (const row of rows ?? []) {
        created.push(row.id);
        const c = chunk.find((x) => x.assignmentId === row.assignment_id);
        if (c) appliedCreates.push(c);
      }
    }

    const appliedUpdates: PlannedUpdate[] = [];
    for (const u of plan.updates) {
      // Guarded on the row still being open: if the owner marks it DONE between our read and this
      // write, the write matches nothing (owner rule: never touch a DONE task).
      const { data, error } = await supabase.from('tasks')
        .update(u.patch).eq('id', u.taskId).neq('status', 'DONE').is('completed_at', null).select('id');
      if (error) { console.error(`[ASSIGNMENT_SYNC] update error ${u.taskId}:`, error); continue; }
      if (data?.length) appliedUpdates.push(u);
    }

    // ---- 6. At most ONE Iris message per run, through the existing scheduled_chat path ----
    // notification-delivery posts metadata.message as an Iris chat message + push (same shape as
    // _shared/task-dedup.ts's notice). Built from what was actually written, so it never claims a
    // change that failed.
    const digest = buildSyncDigest({ creates: appliedCreates, updates: appliedUpdates }, timezone);
    let digestQueued = false;
    if (digest) {
      const { data: prefs } = await supabase.from('notification_prefs')
        .select('quiet_hours_start, quiet_hours_end').eq('user_id', userId).maybeSingle();
      const sendAt = digestSendAt(new Date(nowISO), timezone, prefs?.quiet_hours_start, prefs?.quiet_hours_end);
      const { error } = await supabase.from('scheduled_notifications').insert({
        user_id: userId,
        notification_type: 'scheduled_chat',
        scheduled_for: sendAt,
        title: digest.title,
        body: digest.message,
        metadata: {
          message: digest.message,
          source: 'assignment_sync',
          assignment_sync: {
            created: appliedCreates.map((c) => c.assignmentId),
            updated: appliedUpdates.map((u) => ({ task_id: u.taskId, changes: u.changes, flag: u.flag })),
          },
        },
      });
      if (error) console.error('[ASSIGNMENT_SYNC] digest queue failed:', error);
      else digestQueued = true;
    }

    await supabase.from('activity_log').insert({
      user_id: userId,
      activity_type: 'nightly_assignment_sync',
      status: 'completed',
      metadata: {
        source: 'nexus',
        nexus_rows: plan.scanned,
        current_courses: plan.currentCourses,
        created_count: created.length,
        updated_count: appliedUpdates.length,
        flagged_count: appliedUpdates.filter((u) => u.flag).length,
        done_untouched_count: plan.untouchedDone.length,
        excluded: plan.excluded,
        digest_queued: digestQueued,
        created_ids: created,
        updated_ids: appliedUpdates.map((u) => u.taskId),
      },
    });

    return json({
      success: true,
      dryRun: false,
      created_count: created.length,
      updated_count: appliedUpdates.length,
      created,
      updated: appliedUpdates.map((u) => ({ task_id: u.taskId, changes: u.changes, flag: u.flag })),
      excluded: plan.excluded,
      digest_queued: digestQueued,
    });
  } catch (error) {
    console.error('[ASSIGNMENT_SYNC] Fatal error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
