import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getTodayInTimezone } from "../_shared/timezone.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { userId, timezone: tzInput, dryRun: dryRunInput } = await req.json();
    const timezone = tzInput || 'America/New_York';
    // DRY RUN. Runs the REAL pipeline — real Nexus fetch, real filters, real dedup
    // against the user's real tasks — but performs NO writes, and returns the exact
    // rows it WOULD have inserted/repaired. This is the only way to prove the Nexus
    // repoint against live data without putting rows on the user's board first; a
    // shadow user cannot substitute here because Nexus is keyed by the real user id.
    const dryRun = dryRunInput === true;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    // Timezone-aware "today" so the 30-day archive cutoff matches the user's local day
    const todayISO = getTodayInTimezone(timezone);
    const [ty, tm, td] = todayISO.split('-').map(Number);
    const todayLocalAsUtc = new Date(Date.UTC(ty, tm - 1, td));
    const thirtyDaysAgo = new Date(todayLocalAsUtc.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    console.log(`[ASSIGNMENT_SYNC] Starting for user ${userId} (${timezone}), today=${todayISO}, archive cutoff=${thirtyDaysAgo}`);

    // ============================================================
    // BATCH PRELOAD — one query per source instead of per-assignment
    // ============================================================

    // 1. Default board (one query, used for all inserts)
    const { data: boards } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .limit(1);
    const board = boards?.[0];

    // 2. Preload ALL existing tasks for this user (single query)
    //    We only need: id, title, status, completed_at, assignment_id
    //    PostgREST default limit is 1000 — paginate if needed
    const allTasks: Array<{
      id: string;
      title: string;
      status: string;
      completed_at: string | null;
      assignment_id: string | null;
    }> = [];

    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page, error: pageErr } = await supabase
        .from('tasks')
        .select('id, title, status, completed_at, assignment_id')
        .eq('user_id', userId)
        .range(offset, offset + PAGE - 1);
      if (pageErr) {
        console.error('[ASSIGNMENT_SYNC] Error loading tasks page:', pageErr);
        break;
      }
      if (!page || page.length === 0) break;
      allTasks.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }

    console.log(`[ASSIGNMENT_SYNC] Preloaded ${allTasks.length} existing tasks`);

    // 3. Build in-memory indexes for O(1) lookups
    const tasksByAssignmentId = new Map<string, typeof allTasks[number]>();
    const activeTasksByTitle = new Map<string, typeof allTasks[number]>();
    for (const t of allTasks) {
      if (t.assignment_id) {
        tasksByAssignmentId.set(t.assignment_id, t);
      }
      // Legacy match candidates: assignment_id NULL, not done, not completed
      if (!t.assignment_id && t.completed_at == null && t.status !== 'DONE') {
        // Index by both raw and emoji-prefixed title
        if (!activeTasksByTitle.has(t.title)) {
          activeTasksByTitle.set(t.title, t);
        }
      }
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const repaired: string[] = [];
    const skippedOld: Array<{ id: string; title: string; due_date: string }> = [];
    const noBoardSkipped: string[] = [];
    const plannedInserts: Array<Record<string, unknown>> = [];
    const plannedRepairs: Array<Record<string, unknown>> = [];

    // ============================================================
    // PROCESS ASSIGNMENTS — single query covers both EMBA and MIT
    // (program_id discriminates; `assignments_mit` was merged into
    //  `assignments` in April 2026)
    // ============================================================
    const MIT_PROGRAM_ID = '4793d933-86ca-4fd5-9b4d-e7a593a513a6';

    // ── Nexus (Azure) assignment source ────────────────────────────────────
    const NEXUS_API = Deno.env.get('NEXUS_API_URL') || 'https://nexus-hub-api.azurewebsites.net';

    // SCOPED INTAKE. Deliberately narrow: only courses listed here sync. The Azure
    // store holds 546 open assignments across MIT + EMBA, the vast majority an aged
    // backlog (MOTR/CTO items due as far back as 2025). Syncing all of them would
    // bury the board — exactly the flood this scoping exists to prevent. Add a course
    // id here when it becomes active; remove it when the course ends.
    const ACTIVE_COURSE_IDS: string[] = [
      '8036ebab-d1bc-460b-92b0-c45fb312a12e', // MIT — Applied Generative AI for Digital Transformation
    ];

    // REQUIRED-ONLY FILTER. In this course the 8 "Required Assignment"/"Capstone"
    // items all carry points=1 while the 8 "Module N: Captain's Log" entries carry
    // points=0. `points` is a real structural field — every other candidate column
    // (type/category/priority/submission_types/canvas_meta) is identical or null
    // across both groups — so it discriminates without title pattern-matching, which
    // would silently rot the first time a course labels things differently.
    const isRequired = (a: any) => Number(a?.points ?? 0) > 0;

    // DUE-DATE INFERENCE (user-approved 2026-08-26). The course runs on a strict
    // weekly cadence — the 6 dated Required Assignments are exactly 7 days apart
    // (7/14, 7/21, 7/28, 8/4, 8/11, 8/18) — but the two REMAINING items (7.1 and the
    // 8.1 Capstone) carry no due_date in Nexus. Without a date they are invisible to
    // the scheduler, so the genuinely upcoming work would never surface. Extrapolate
    // the cadence from the latest dated assignment, ordered by the N.1 number in the
    // title, so 7.1 -> 8/25 and Capstone 8.1 -> 9/1.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    function inferMissingDueDates(list: any[]): any[] {
      const seq = (t: string) => {
        const m = /(\d+)\.\d+/.exec(t || '');
        return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
      };
      const dated = list.filter((a) => a.due_date).sort((a, b) => +new Date(a.due_date) - +new Date(b.due_date));
      if (dated.length === 0) return list; // nothing to extrapolate from — leave as-is
      const lastDated = dated[dated.length - 1];
      const anchorMs = +new Date(lastDated.due_date);
      const anchorSeq = seq(lastDated.title);

      return list.map((a) => {
        if (a.due_date) return a;
        const s = seq(a.title);
        if (s === Number.MAX_SAFE_INTEGER || s <= anchorSeq) return a; // can't place it in the sequence
        const inferred = new Date(anchorMs + (s - anchorSeq) * WEEK_MS);
        console.log(`[ASSIGNMENT_SYNC] Inferred due date for "${a.title}": ${inferred.toISOString().slice(0, 10)} (weekly cadence from ${lastDated.due_date?.slice(0, 10)})`);
        return { ...a, due_date: inferred.toISOString(), _due_date_inferred: true };
      });
    }

    async function fetchNexusAssignments(uid: string): Promise<any[]> {
      const out: any[] = [];
      for (const courseId of ACTIVE_COURSE_IDS) {
        const url = `${NEXUS_API}/api/d1/assignments?owner=${encodeURIComponent(uid)}&course_id=${encodeURIComponent(courseId)}`;
        try {
          const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
          if (!res.ok) {
            console.error(`[ASSIGNMENT_SYNC] Nexus fetch failed for course ${courseId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
            continue;
          }
          const body = await res.json();
          const rows: any[] = Array.isArray(body) ? body : (body?.data ?? body?.rows ?? []);
          const open = rows.filter((a) => !['completed', 'graded'].includes(String(a?.status ?? '')));
          const required = open.filter(isRequired);
          console.log(`[ASSIGNMENT_SYNC] Nexus course ${courseId}: ${rows.length} rows, ${open.length} open, ${required.length} required (points>0)`);
          // Tag as scoped so the age cutoff below knows this row survived an explicit
          // active-course + required-only filter and is therefore live work, not backlog.
          out.push(...inferMissingDueDates(required).map((a) => ({ ...a, _scoped_active_course: true })));
        } catch (e) {
          // Never fail the whole nightly run because Nexus is unreachable.
          console.error(`[ASSIGNMENT_SYNC] Nexus fetch threw for course ${courseId}:`, e instanceof Error ? e.message : e);
        }
      }
      return out;
    }

    async function syncAssignments() {
      // ==========================================================
      // SOURCE OF TRUTH IS NEXUS ON AZURE — NOT SUPABASE.
      //
      // nexus-hub migrated `assignments`/`programs`/`courses` to Azure
      // (content.* schema, served by nexus-hub-api /api/d1/<table>; the app ships
      // VITE_DATA_SOURCE_D1='azure' by default). The Supabase `public.assignments`
      // table is a DEAD SNAPSHOT frozen at the 2026-04-06 migration — every row
      // there was created that day.
      //
      // Measured 2026-08-26: Supabase's newest MIT assignment was due 2026-06-23,
      // while Azure held the live "Applied Generative AI for Digital Transformation"
      // course ingested 2026-08-19/20 with assignments due through 2026-08-18 and
      // beyond. Reading Supabase meant journey could not see the active course AT
      // ALL — which is why no program work ever reached the board.
      //
      // Reads use the `?owner=` fallback (unverified, reads only — see nexus-hub
      // api/src/lib/auth.ts resolveOwner), so this needs NO session token and NO
      // new secret, honouring the standing "don't mint new org secrets" rule.
      // ==========================================================
      const assignments = await fetchNexusAssignments(userId);
      if (!assignments || assignments.length === 0) {
        console.log(`[ASSIGNMENT_SYNC] No assignments to process`);
        return;
      }

      const embaCount = assignments.filter((a) => a.program_id !== MIT_PROGRAM_ID).length;
      const mitCount = assignments.length - embaCount;
      console.log(`[ASSIGNMENT_SYNC] Found ${assignments.length} assignments (EMBA=${embaCount}, MIT=${mitCount})`);

      const repairs: Array<{ taskId: string; assignmentId: string; due_date: string | null; source: string }> = [];
      const inserts: Array<Record<string, unknown>> = [];

      for (const assignment of assignments) {
        const source = assignment.program_id === MIT_PROGRAM_ID ? 'MIT' : 'EMBA';

        // Layer 1: assignment_id match
        if (tasksByAssignmentId.has(assignment.id)) {
          skipped.push(assignment.id);
          continue;
        }

        // Layer 2 + 3: legacy title match (raw OR emoji-prefixed)
        const legacy =
          activeTasksByTitle.get(assignment.title) ||
          activeTasksByTitle.get(`📚 ${assignment.title}`);

        if (legacy) {
          repairs.push({
            taskId: legacy.id,
            assignmentId: assignment.id,
            due_date: assignment.due_date
              ? new Date(assignment.due_date).toISOString().split('T')[0] + 'T23:59:59Z'
              : null,
            source,
          });
          tasksByAssignmentId.set(assignment.id, legacy);
          activeTasksByTitle.delete(assignment.title);
          activeTasksByTitle.delete(`📚 ${assignment.title}`);
          repaired.push(legacy.id);
          skipped.push(assignment.id);
          continue;
        }

        // Skip very old past-due assignments (>30 days, anchored to local today).
        //
        // EXEMPT the scoped active-course set. The cutoff is a blunt anti-flood guard
        // from when this function read EVERY assignment in the store; ACTIVE_COURSE_IDS
        // + points>0 now does that job precisely, so age is no longer a proxy for
        // "irrelevant". Concretely, on 2026-08-28 the cutoff (2026-07-29) would drop
        // Required Assignments 1.1 / 2.1 / 3.1 (due 7/14, 7/21, 7/28) — three of the
        // eight items in a course the user is actively taking and has NOT completed.
        // Dropping outstanding coursework because it is late is precisely backwards.
        // The guard stays in force for any unscoped source added later.
        if (!assignment._scoped_active_course && assignment.due_date && assignment.due_date < thirtyDaysAgo) {
          skippedOld.push({
            id: assignment.id,
            title: assignment.title,
            due_date: assignment.due_date,
          });
          skipped.push(assignment.id);
          continue;
        }

        if (!board) {
          noBoardSkipped.push(assignment.id);
          continue;
        }

        // Determine estimate from level_of_effort
        let estimateMinutes = 90;
        if (assignment.level_of_effort) {
          const loe = assignment.level_of_effort.toLowerCase();
          if (loe.includes('low') || loe.includes('small')) estimateMinutes = 45;
          else if (loe.includes('high') || loe.includes('large')) estimateMinutes = 180;
          else if (loe.includes('medium')) estimateMinutes = 90;
        }

        inserts.push({
          title: `📚 ${assignment.title}`,
          description: assignment.description || `Assignment from ${source}. Due: ${assignment.due_date}`,
          category: 'PROF_EDUCATION',
          priority: assignment.priority?.toUpperCase() || 'HIGH',
          status: 'TODO',
          due_date: assignment.due_date
            ? new Date(assignment.due_date).toISOString().split('T')[0] + 'T23:59:59Z'
            : null,
          estimate_minutes: estimateMinutes,
          is_scheduled: false,
          board_id: board.id,
          user_id: userId,
          assignment_id: assignment.id,
          // Record WHERE the row came from and whether its due date was inferred rather
          // than read, so a wrong inferred date is traceable to this function instead of
          // looking like Nexus data.
          scheduling_context: {
            source,
            origin: 'nexus-azure',
            course_id: assignment.course_id ?? null,
            ...(assignment._due_date_inferred ? { due_date_inferred: true } : {}),
          },
        });
      }

      if (dryRun) {
        console.log(`[ASSIGNMENT_SYNC] DRY RUN — no writes. would_insert=${inserts.length}, would_repair=${repairs.length}, skipped=${skipped.length}, skipped_old=${skippedOld.length}`);
        for (const i of inserts) {
          console.log(`[ASSIGNMENT_SYNC]   + ${String(i.due_date).slice(0, 10)}  ${String(i.title).slice(0, 70)}`);
        }
        plannedInserts.push(...inserts);
        plannedRepairs.push(...repairs);
        return;
      }

      // ----- BULK REPAIR (chunked updates) -----
      const REPAIR_CHUNK = 50;
      for (let i = 0; i < repairs.length; i += REPAIR_CHUNK) {
        const chunk = repairs.slice(i, i + REPAIR_CHUNK);
        await Promise.all(chunk.map((r) =>
          supabase
            .from('tasks')
            .update({
              assignment_id: r.assignmentId,
              due_date: r.due_date,
              scheduling_context: { source: r.source },
              updated_at: now.toISOString(),
            })
            .eq('id', r.taskId)
        ));
      }

      // ----- BULK INSERT (chunked) -----
      const INSERT_CHUNK = 100;
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
        const chunk = inserts.slice(i, i + INSERT_CHUNK);
        const { data: newRows, error: insertErr } = await supabase
          .from('tasks')
          .insert(chunk)
          .select('id, assignment_id');

        if (insertErr) {
          console.error(`[ASSIGNMENT_SYNC] Bulk insert error (chunk ${i}):`, insertErr);
        } else if (newRows) {
          for (const row of newRows) {
            created.push(row.id);
            if (row.assignment_id) tasksByAssignmentId.set(row.assignment_id, row as any);
          }
        }
      }

      console.log(`[ASSIGNMENT_SYNC] scanned=${assignments.length}, inserts=${inserts.length}, repairs=${repairs.length}, skipped_old=${skippedOld.length}`);
    }

    await syncAssignments();

    if (!board) {
      console.error(`[ASSIGNMENT_SYNC] ⚠️ No default board for user ${userId} — ${noBoardSkipped.length} assignments could not be promoted`);
    }

    const totalProcessed = created.length + repaired.length + skipped.length;
    const skipRate = totalProcessed > 0 ? skipped.length / totalProcessed : 0;
    if (skipRate > 0.9 && totalProcessed > 10) {
      console.warn(`[ASSIGNMENT_SYNC] ⚠️ HIGH SKIP RATE: ${(skipRate * 100).toFixed(0)}% (${skipped.length}/${totalProcessed}).`);
    }

    // Log activity (a dry run writes nothing at all, activity_log included)
    if (!dryRun) await supabase.from('activity_log').insert({
      user_id: userId,
      activity_type: 'nightly_assignment_sync',
      status: 'completed',
      metadata: {
        created_count: created.length,
        repaired_count: repaired.length,
        skipped_count: skipped.length,
        skipped_old_count: skippedOld.length,
        no_board_skipped_count: noBoardSkipped.length,
        created_ids: created,
        repaired_ids: repaired,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      ...(dryRun ? {
        would_insert_count: plannedInserts.length,
        would_repair_count: plannedRepairs.length,
        would_insert: plannedInserts.map((i) => ({
          title: i.title,
          due_date: i.due_date,
          category: i.category,
          priority: i.priority,
          estimate_minutes: i.estimate_minutes,
          assignment_id: i.assignment_id,
          scheduling_context: i.scheduling_context,
        })),
        would_repair: plannedRepairs,
      } : {}),
      created_count: created.length,
      repaired_count: repaired.length,
      skipped_count: skipped.length,
      skipped_old_count: skippedOld.length,
      no_board_skipped_count: noBoardSkipped.length,
      created,
      repaired,
      skipped_old: skippedOld,
      no_board_skipped: noBoardSkipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ASSIGNMENT_SYNC] Fatal error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
