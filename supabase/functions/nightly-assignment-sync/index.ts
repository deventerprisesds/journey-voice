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

    // ==========================================
    // STEP 0: Archive stale PROF_EDUCATION tasks without assignment_id
    // These are legacy tasks created before the assignment_id column existed
    // ==========================================
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const { data: legacyStaleTasks, error: legacyError } = await supabase
      .from('tasks')
      .select('id, title, due_date, pushed_count')
      .eq('user_id', userId)
      .in('category', ['PROF_EDUCATION', 'EDUCATION'])
      .is('assignment_id', null)
      .is('completed_at', null)
      .not('status', 'eq', 'DONE')
      .lt('due_date', thirtyDaysAgo);

    if (!legacyError && legacyStaleTasks && legacyStaleTasks.length > 0) {
      console.log(`[ASSIGNMENT_SYNC] Found ${legacyStaleTasks.length} legacy stale PROF_EDUCATION tasks to archive`);
      for (const stale of legacyStaleTasks) {
        const { error: archError } = await supabase
          .from('tasks')
          .update({
            status: 'DONE',
            completed_at: now.toISOString(),
            updated_at: now.toISOString(),
            scheduling_context: {
              archived_reason: 'legacy_stale_assignment',
              original_due_date: stale.due_date,
              pushed_count: stale.pushed_count,
            },
          })
          .eq('id', stale.id);

        if (!archError) {
          archived.push(stale.id);
          console.log(`  🗑️ Archived legacy stale: "${stale.title}" (due ${stale.due_date})`);
        }
      }
    }

    // Helper: normalize title for fuzzy matching
    function normalizeTitle(title: string): string {
      return title
        .toLowerCase()
        .replace(/^📚\s*/, '') // Remove emoji prefix we add
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
    }

    // Helper: sync assignments from a table
    async function syncAssignments(tableName: string, source: string) {
      // Only fetch assignments due within the last 30 days to 14 days ahead
      // This avoids processing hundreds of ancient assignments and timing out
      const { data: assignments, error } = await supabase
        .from(tableName)
        .select('id, title, due_date, description, category, priority, level_of_effort, status')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","graded","past due")')
        .gte('due_date', thirtyDaysAgo)
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
        // Check if a task already exists for this assignment (by assignment_id)
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
                scheduling_context: {
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

        // SECONDARY DEDUP: exact title match only (for legacy tasks without assignment_id)
        const { data: titleMatches } = await supabase
          .from('tasks')
          .select('id, title, status')
          .eq('user_id', userId)
          .is('assignment_id', null)
          .is('completed_at', null)
          .not('status', 'eq', 'DONE')
          .or(`title.eq.${assignment.title},title.eq.📚 ${assignment.title}`);

        if (titleMatches && titleMatches.length > 0) {
          // Found a legacy task matching this assignment's title — link it
          const legacyTask = titleMatches[0];
          console.log(`  🔗 Linking legacy task "${legacyTask.title}" to assignment "${assignment.title}" (id: ${assignment.id})`);
          
          await supabase
            .from('tasks')
            .update({
              assignment_id: assignment.id,
              due_date: assignment.due_date ? `${assignment.due_date}T23:59:59Z` : null,
              updated_at: now.toISOString(),
            })
            .eq('id', legacyTask.id);
          
          skipped.push(assignment.id);
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

        // Get default board (use limit 1 in case of duplicates)
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
