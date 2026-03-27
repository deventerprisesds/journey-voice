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
    const archived: string[] = [];
    const skipped: string[] = [];

    // Helper: sync assignments from a table
    async function syncAssignments(tableName: string, source: string) {
      const { data: assignments, error } = await supabase
        .from(tableName)
        .select('id, title, due_date, description, category, priority, level_of_effort, status')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","graded","past due")')
        .lte('due_date', futureDateISO);

      if (error) {
        console.error(`[ASSIGNMENT_SYNC] Error fetching ${tableName}:`, error);
        return;
      }

      if (!assignments || assignments.length === 0) {
        console.log(`[ASSIGNMENT_SYNC] No upcoming assignments in ${tableName}`);
        return;
      }

      console.log(`[ASSIGNMENT_SYNC] Found ${assignments.length} assignments in ${tableName}`);

      for (const assignment of assignments) {
        // Check if a task already exists for this assignment
        const { data: existingTask } = await supabase
          .from('tasks')
          .select('id, status')
          .eq('user_id', userId)
          .eq('assignment_id', assignment.id)
          .maybeSingle();

        if (existingTask) {
          // Check if overdue and not done — archive it
          if (assignment.due_date && assignment.due_date < todayISO && existingTask.status !== 'DONE') {
            const { error: archiveError } = await supabase
              .from('tasks')
              .update({
                status: 'DONE',
                completed_at: now.toISOString(),
                updated_at: now.toISOString(),
                metadata: {
                  archived_reason: 'overdue_assignment',
                  original_due_date: assignment.due_date,
                  source,
                },
              })
              .eq('id', existingTask.id);

            if (!archiveError) {
              archived.push(existingTask.id);
              console.log(`  📦 Archived overdue task for "${assignment.title}" (due ${assignment.due_date})`);
            }
          } else {
            skipped.push(assignment.id);
          }
          continue;
        }

        // Skip if overdue and no task exists — don't create a new task for past assignments
        if (assignment.due_date && assignment.due_date < todayISO) {
          console.log(`  ⏭️ Skipping past-due assignment "${assignment.title}" (due ${assignment.due_date})`);
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

        // Get or create default board
        const { data: board } = await supabase
          .from('boards')
          .select('id')
          .eq('user_id', userId)
          .eq('is_default', true)
          .maybeSingle();

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
          due_date: assignment.due_date ? `${assignment.due_date}T23:59:59Z` : null,
          estimate_minutes: estimateMinutes,
          is_scheduled: false,
          board_id: board.id,
          user_id: userId,
          assignment_id: assignment.id,
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

    console.log(`[ASSIGNMENT_SYNC] Complete: ${created.length} created, ${archived.length} archived, ${skipped.length} skipped`);

    // Log activity
    await supabase.from('activity_log').insert({
      user_id: userId,
      activity_type: 'nightly_assignment_sync',
      status: 'completed',
      metadata: {
        created_count: created.length,
        archived_count: archived.length,
        skipped_count: skipped.length,
        created_ids: created,
        archived_ids: archived,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      created,
      archived,
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
