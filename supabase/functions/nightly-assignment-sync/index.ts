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
    const { userId, timezone: tzInput } = await req.json();
    const timezone = tzInput || 'America/New_York';

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

    // ============================================================
    // PROCESS ASSIGNMENTS — single query covers both EMBA and MIT
    // (program_id discriminates; `assignments_mit` was merged into
    //  `assignments` in April 2026)
    // ============================================================
    const MIT_PROGRAM_ID = '4793d933-86ca-4fd5-9b4d-e7a593a513a6';

    async function syncAssignments() {
      const { data: assignments, error } = await supabase
        .from('assignments')
        .select('id, title, due_date, description, category, priority, level_of_effort, status, assignment_url, program_id')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","graded")');

      if (error) {
        console.error(`[ASSIGNMENT_SYNC] Error fetching assignments:`, error);
        return;
      }
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

        // Skip very old past-due assignments (>30 days, anchored to local today)
        if (assignment.due_date && assignment.due_date < thirtyDaysAgo) {
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
          scheduling_context: { source },
        });
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

    // Log activity
    await supabase.from('activity_log').insert({
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
