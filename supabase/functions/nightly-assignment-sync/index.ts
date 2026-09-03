import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getTodayInTimezone } from "../_shared/timezone.ts";
import {
  fetchNexusAssignments as fetchNexusAssignments_shared,
  resolveActiveCourseIds,
  scopeToActiveCourses,
  isRequiredAssignment,
} from "../_shared/nexus.ts";
import { inferMissingDueDatesByCourse, isDueDateInferred } from "../_shared/assignment-cadence.ts";

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
    let capExceeded = false;

    // ============================================================
    // PROCESS ASSIGNMENTS — single query covers both EMBA and MIT
    // (program_id discriminates; `assignments_mit` was merged into
    //  `assignments` in April 2026)
    // ============================================================
    // RETAINED DELIBERATELY, and it is a PROGRAM id, not a course id (AC-3a). It selects
    // NOTHING — it is only the 'MIT' vs 'EMBA' label written into the task description and
    // `scheduling_context.source`. Removing the course pin removed the only literal that
    // decided what gets ingested; this one decides how an already-ingested row is labelled.
    // If it is ever wrong the effect is a mislabelled task, never a missing or extra one.
    const MIT_PROGRAM_ID = '4793d933-86ca-4fd5-9b4d-e7a593a513a6';

    // ── Nexus (Azure) assignment source ────────────────────────────────────
    // SCOPE IS INFERRED, NEVER PINNED. This function used to hardcode a single course
    // uuid in an ACTIVE_COURSE_IDS array. That was production data ingestion behaving
    // like a test fixture, and the independent verifier measured the cost: the
    // `list_pending_assignments` agent tool resolves its course set DYNAMICALLY
    // (execute-tool/index.ts:2685-2692 -> scopeToActiveCourses) and admitted TWO
    // courses while this sync ingested ONE, so the tool named 13 pending items the
    // scheduler could never place. One pipeline, two disagreeing scopes.
    //
    // Both sides now resolve the same way, from the same shared function, over the
    // same universe of rows — see `resolveScope` below. There is no course uuid in
    // this file.
    const DEFAULT_MAX_INTAKE_PER_RUN = 40;

    // Per-user knobs, read from the same place the agent tool reads them so the two
    // cannot drift. Absent/unreadable -> {} and the inferred defaults apply; a config
    // read must never break the sync.
    let asgCfg: Record<string, any> = {};
    try {
      const { data: prefRow } = await supabase
        .from('user_scheduling_prefs')
        .select('config')
        .eq('user_id', userId)
        .maybeSingle();
      asgCfg = ((prefRow?.config as any)?.assignments ?? {}) as Record<string, any>;
    } catch (_) { /* defaults */ }

    // EXACTLY the option object `listPendingAssignments` builds. Kept as one value so a
    // change to either consumer is visibly a change to both.
    const scopeOpts = {
      activeCourseIds: asgCfg.activeCourseIds,
      excludeCourseIds: asgCfg.excludeCourseIds,
      eraDays: asgCfg.activeCourseEraDays,
      includeUncoursed: asgCfg.includeUncoursed === true,
    };
    // points>0 ("Required Assignment"/"Capstone") is what keeps ungraded Captain's-Log
    // entries off the board. It is the ONE deliberate difference from the tool's scope
    // — the tool REPORTS everything open, the sync INGESTS only graded work — so it is
    // exposed as a setting rather than left as a code-only constant.
    const requiredOnly = asgCfg.requiredOnly !== false;
    const maxIntakeRaw = Number(asgCfg.maxIntakePerRun);
    const maxIntakePerRun = Number.isFinite(maxIntakeRaw) && maxIntakeRaw > 0
      ? Math.floor(maxIntakeRaw)
      : DEFAULT_MAX_INTAKE_PER_RUN;

    let resolvedCourseIds: string[] = [];
    let nexusOpenCount = 0;
    let scopedCount = 0;

    // DUE-DATE INFERENCE now lives in _shared/assignment-cadence.ts so the agent tool can
    // apply the identical rule (AC-2b). It used to be a private copy in this file, which
    // meant the sync and the tool could report different due dates for the same
    // assignment. Grouping is BY COURSE: with the scope unpinned this function now sees
    // several courses at once, and extrapolating course A's missing date from course B's
    // cadence would be nonsense. The single-course pin used to hide that.

    async function fetchNexusAssignments(uid: string): Promise<any[]> {
      // Fetch EVERY open assignment, DELIBERATELY UNSCOPED BY COURSE.
      //
      // DO NOT "optimise" this by passing `courseIds: asgCfg.activeCourseIds`.
      // `_shared/nexus.ts:330-332` issues one request per course id, or ONE UNFILTERED
      // REQUEST FOR EVERYTHING when the list is empty or absent — and
      // `config.assignments.activeCourseIds` is genuinely null on the live config. So
      // that edit reads as "scope it" and behaves as "fetch all 546 rows and scope
      // nothing". The active set has to be INFERRED FROM the rows, which means the rows
      // must be fetched first. This is the fetch-wide-then-scope shape on purpose.
      const allOpen = await fetchNexusAssignments_shared(uid, { openOnly: true });
      nexusOpenCount = allOpen.length;

      const activeIds = resolveActiveCourseIds(allOpen, scopeOpts);
      resolvedCourseIds = [...activeIds].sort();
      const scoped = scopeToActiveCourses(allOpen, scopeOpts);
      scopedCount = scoped.length;

      console.log(
        `[ASSIGNMENT_SYNC] Nexus open=${allOpen.length}; active courses=${activeIds.size} `
        + `[${resolvedCourseIds.join(', ') || 'none'}]; in scope=${scoped.length}`,
      );

      // FAIL CLOSED. An empty active set means "we could not tell what is current", and
      // the safe answer is to ingest nothing — never to fall back to everything.
      if (activeIds.size === 0 && !scopeOpts.includeUncoursed) {
        console.warn('[ASSIGNMENT_SYNC] ⚠️ No active course resolved — ingesting nothing this run.');
        return [];
      }

      const required = requiredOnly ? scoped.filter(isRequiredAssignment) : scoped;
      console.log(
        `[ASSIGNMENT_SYNC] required_only=${requiredOnly} -> ${required.length} candidate assignment(s)`,
      );

      // Tag as scoped so the age cutoff below knows these rows survived the active-course
      // (+ required) filter and are live work, not backlog.
      return inferMissingDueDatesByCourse(required, {
        log: (m) => console.log(m.replace('[CADENCE]', '[ASSIGNMENT_SYNC]')),
      }).map((a) => ({ ...a, _scoped_active_course: true }));
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
        // from when this function read EVERY assignment in the store; the resolved
        // active-course set + points>0 now does that job precisely, so age is no longer
        // a proxy for "irrelevant". Concretely, on 2026-08-28 the cutoff (2026-07-29)
        // would drop Required Assignments 1.1 / 2.1 / 3.1 (due 7/14, 7/21, 7/28) — three
        // of the eight items in a course the user is actively taking and has NOT
        // completed. Dropping outstanding coursework because it is late is precisely
        // backwards. The guard stays in force for any unscoped source added later.
        //
        // NOTE now that the scope is INFERRED rather than pinned: this exemption follows
        // whatever `resolveActiveCourseIds` admits, so a newly-ingested-but-long-finished
        // course would have its aged items exempted too. Measured 2026-09-03 that is a
        // no-op — the second admitted course ("AI and Business Strategy") has ZERO rows
        // with points>0 — and the intake cap below bounds the damage if it ever is not.
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
            // AC-2e: an extrapolated deadline must never reach the user as a published one.
            // `isDueDateInferred` is the single reader of the marker key, so renaming the key
            // in _shared/assignment-cadence.ts cannot silently orphan this branch.
            ...(isDueDateInferred(assignment) ? { due_date_inferred: true } : {}),
          },
        });
      }

      // ── INTAKE CAP ────────────────────────────────────────────────────────
      // The hardcoded course pin this function used to carry was, in the author's own
      // words, flood prevention. Removing it removes that protection, so the protection
      // is replaced with something that does not need to know any course id: a bound on
      // how many NEW tasks one run may create. A run that wants more than this has
      // almost certainly resolved a scope nobody intended (a config typo, an
      // `includeUncoursed` flip, a bulk re-import), and the right response is to stop
      // and say so — a flooded board is not cheaply reversible.
      //
      // Measured 2026-09-03 for the live user: the inferred scope yields 8 candidate
      // assignments, so the default of 40 is ~5x headroom and cannot fire in normal use.
      // Overridable per user via `config.assignments.maxIntakePerRun`.
      if (inserts.length > maxIntakePerRun) {
        console.error(
          `[ASSIGNMENT_SYNC] ⛔ INTAKE CAP EXCEEDED — ${inserts.length} new tasks requested, `
          + `cap is ${maxIntakePerRun}. Writing NOTHING. Resolved courses: `
          + `[${resolvedCourseIds.join(', ') || 'none'}]. Raise config.assignments.maxIntakePerRun `
          + `if this is genuinely intended.`,
        );
        capExceeded = true;
        plannedInserts.push(...inserts);
        plannedRepairs.push(...repairs);
        return;
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
      // AC-3b: the resolved course set is part of the RESULT, not only a log line, so
      // "does the sync's scope equal the tool's scope?" is answerable by comparing two
      // responses instead of by reading two log streams.
      scope: {
        active_course_ids: resolvedCourseIds,
        nexus_open_count: nexusOpenCount,
        in_scope_count: scopedCount,
        required_only: requiredOnly,
        include_uncoursed: scopeOpts.includeUncoursed,
        era_days: scopeOpts.eraDays ?? null,
        pinned_course_ids: scopeOpts.activeCourseIds ?? null,
        excluded_course_ids: scopeOpts.excludeCourseIds ?? null,
        max_intake_per_run: maxIntakePerRun,
        intake_cap_exceeded: capExceeded,
      },
      ...(capExceeded ? { would_insert_count: plannedInserts.length } : {}),
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
