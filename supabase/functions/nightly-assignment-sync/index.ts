import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const { userId, timezone } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const futureDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const futureDateISO = futureDate.toISOString().split('T')[0];

    console.log(`[ASSIGNMENT_SYNC] Starting for user ${userId}, window: ${todayISO} to ${futureDateISO}`);

    const created: string[] = [];
    const skipped: string[] = [];
    const repaired: string[] = [];

    // Helper: sync assignments from a table and create linked tasks
    async function syncAssignments(tableName: string, source: string) {
      // Fetch all non-completed assignments (no narrow time window — full sync)
      const { data: assignments, error } = await supabase
        .from(tableName)
        .select('id, title, due_date, description, category, priority, level_of_effort, status, assignment_url')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","graded")');

      if (error) {
        console.error(`[ASSIGNMENT_SYNC] Error fetching ${tableName}:`, error);
        return;
      }

      if (!assignments || assignments.length === 0) {
        console.log(`[ASSIGNMENT_SYNC] No assignments in ${tableName}`);
        return;
      }

      console.log(`[ASSIGNMENT_SYNC] Found ${assignments.length} assignments in ${tableName}`);

      for (const assignment of assignments) {
        // Check if a task already exists for this assignment (by assignment_id)
        const { data: existingTask } = await supabase
          .from('tasks')
          .select('id, status, completed_at')
          .eq('user_id', userId)
          .eq('assignment_id', assignment.id)
          .maybeSingle();

        if (existingTask) {
          skipped.push(assignment.id);
          continue;
        }

        // SECONDARY DEDUP: exact title match for legacy tasks without assignment_id
        // Use two separate .eq() queries to avoid PostgREST .or() comma-delimiter bugs
        const { data: exactMatch } = await supabase
          .from('tasks')
          .select('id, title, status')
          .eq('user_id', userId)
          .is('assignment_id', null)
          .is('completed_at', null)
          .not('status', 'eq', 'DONE')
          .eq('title', assignment.title)
          .limit(1);

        const { data: emojiMatch } = !exactMatch?.length
          ? await supabase
              .from('tasks')
              .select('id, title, status')
              .eq('user_id', userId)
              .is('assignment_id', null)
              .is('completed_at', null)
              .not('status', 'eq', 'DONE')
              .eq('title', `📚 ${assignment.title}`)
              .limit(1)
          : { data: null };

        const titleMatches = [...(exactMatch || []), ...(emojiMatch || [])];

        if (titleMatches.length > 0) {
          // Found a legacy task — link it and repair
          const legacyTask = titleMatches[0];
          console.log(`  🔗 Linking legacy task "${legacyTask.title}" to assignment "${assignment.title}" (id: ${assignment.id})`);
          
          await supabase
            .from('tasks')
            .update({
              assignment_id: assignment.id,
              due_date: assignment.due_date ? new Date(assignment.due_date).toISOString().split('T')[0] + 'T23:59:59Z' : null,
              scheduling_context: { source },
              updated_at: now.toISOString(),
            })
            .eq('id', legacyTask.id);
          
          repaired.push(legacyTask.id);
          skipped.push(assignment.id);
          continue;
        }

        // Skip creating new tasks for very old past-due assignments (>30 days)
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        if (assignment.due_date && assignment.due_date < thirtyDaysAgo) {
          console.log(`  ⏭️ Skipping very old assignment "${assignment.title}" (due ${assignment.due_date})`);
          skipped.push(assignment.id);
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

        // Get default board
        const { data: boards } = await supabase
          .from('boards')
          .select('id')
          .eq('user_id', userId)
          .eq('is_default', true)
          .limit(1);

        const board = boards?.[0];
        if (!board) {
          console.error(`[ASSIGNMENT_SYNC] No default board for user ${userId}`);
          continue;
        }

        const taskData = {
          title: `📚 ${assignment.title}`,
          description: assignment.description || `Assignment from ${source}. Due: ${assignment.due_date}`,
          category: 'PROF_EDUCATION',
          priority: assignment.priority?.toUpperCase() || 'HIGH',
          status: 'TODO',
          due_date: assignment.due_date ? new Date(assignment.due_date).toISOString().split('T')[0] + 'T23:59:59Z' : null,
          estimate_minutes: estimateMinutes,
          is_scheduled: false,
          board_id: board.id,
          user_id: userId,
          assignment_id: assignment.id,
          assignment_url: assignment.assignment_url || null,
          scheduling_context: { source },
        };

        const { data: newTask, error: insertError } = await supabase
          .from('tasks')
          .insert([taskData])
          .select('id')
          .single();

        if (insertError) {
          console.error(`[ASSIGNMENT_SYNC] Error creating task for "${assignment.title}":`, insertError);
        } else {
          created.push(newTask.id);
          console.log(`  ✅ Created task for "${assignment.title}" (due ${assignment.due_date}, est ${estimateMinutes}m)`);
        }
      }
    }

    // Sync from both assignment tables
    await syncAssignments('assignments', 'EMBA');
    await syncAssignments('assignments_mit', 'MIT');

    const totalProcessed = created.length + repaired.length + skipped.length;
    const skipRate = totalProcessed > 0 ? skipped.length / totalProcessed : 0;
    if (skipRate > 0.9 && totalProcessed > 10) {
      console.warn(`[ASSIGNMENT_SYNC] ⚠️ HIGH SKIP RATE: ${(skipRate * 100).toFixed(0)}% (${skipped.length}/${totalProcessed}). Possible dedup bug or all assignments already linked.`);
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
        created_ids: created,
        repaired_ids: repaired,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      created,
      repaired,
      skipped,
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
