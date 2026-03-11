import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Priority keywords that get a scheduling boost
const PRIORITY_KEYWORDS = {
  financial: ['payment', 'invoice', 'bill', 'tax', 'budget', 'contract', 'financial', 'money', 'pay'],
  comms: ['email', 'follow up', 'follow-up', 'respond', 'reply', 'call', 'meeting', 'text', 'message', 'contact'],
};

function hasPriorityKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  return [...PRIORITY_KEYWORDS.financial, ...PRIORITY_KEYWORDS.comms].some(kw => lower.includes(kw));
}

function isDueSoon(dueDate: string | null, hoursThreshold = 48): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const cutoff = new Date(Date.now() + hoursThreshold * 60 * 60 * 1000);
  return due <= cutoff;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get all users with scheduling preferences (or all users with tasks)
    const { data: users, error: usersError } = await supabase
      .from('user_scheduling_prefs')
      .select('user_id, config, timezone');

    if (usersError) throw usersError;
    
    if (!users || users.length === 0) {
      console.log('⚠️ No users with scheduling preferences found');
      return new Response(JSON.stringify({ message: 'No users to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Record<string, any> = {};

    for (const userPref of users) {
      const userId = userPref.user_id;
      const timezone = userPref.timezone || 'America/New_York';
      
      console.log(`\n🌙 Processing nightly schedule for user ${userId} (${timezone})`);
      
      try {
        // ==========================================
        // STEP 1: ROLLOVER — Reset incomplete past tasks
        // ==========================================
        const now = new Date();
        const todayStart = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        todayStart.setHours(0, 0, 0, 0);
        
        // Find tasks that were scheduled in the past and not completed
        const { data: expiredTasks, error: expiredError } = await supabase
          .from('tasks')
          .select('id, title, pushed_count, start_time, status')
          .eq('user_id', userId)
          .eq('is_scheduled', true)
          .not('status', 'eq', 'DONE')
          .lt('start_time', now.toISOString());

        if (expiredError) {
          console.error(`❌ Error fetching expired tasks for ${userId}:`, expiredError);
          continue;
        }

        let rolledOverCount = 0;
        if (expiredTasks && expiredTasks.length > 0) {
          for (const task of expiredTasks) {
            const { error: updateError } = await supabase
              .from('tasks')
              .update({
                start_time: null,
                end_time: null,
                is_scheduled: false,
                status: 'UP_NEXT',
                pushed_count: (task.pushed_count || 0) + 1,
                updated_at: now.toISOString(),
              })
              .eq('id', task.id);

            if (updateError) {
              console.error(`❌ Error rolling over task ${task.id}:`, updateError);
            } else {
              rolledOverCount++;
              console.log(`  ↩️ Rolled over: "${task.title}" (pushed ×${(task.pushed_count || 0) + 1})`);
            }
          }
        }
        console.log(`  📋 Rolled over ${rolledOverCount} tasks`);

        // ==========================================
        // STEP 2: GATHER CANDIDATES from priority board
        // ==========================================
        const { data: mappedTasks, error: mappedError } = await supabase
          .from('task_topic_mappings')
          .select('task_id')
          .eq('user_id', userId);

        if (mappedError) {
          console.error(`❌ Error fetching topic mappings for ${userId}:`, mappedError);
          continue;
        }

        const mappedIds = (mappedTasks || []).map((t: any) => t.task_id);

        if (mappedIds.length === 0) {
          console.log(`  ℹ️ No priority board tasks for ${userId}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0 };
          continue;
        }

        const { data: candidates, error: candidatesError } = await supabase
          .from('tasks')
          .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status')
          .in('id', mappedIds)
          .not('status', 'in', '("DONE","BLOCKED")')
          .is('is_scheduled', false)
          .is('completed_at', null)
          .order('created_at', { ascending: true })
          .limit(30);

        if (candidatesError) {
          console.error(`❌ Error fetching candidates for ${userId}:`, candidatesError);
          continue;
        }

        if (!candidates || candidates.length === 0) {
          console.log(`  ℹ️ No unscheduled candidates for ${userId}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0 };
          continue;
        }

        // ==========================================
        // STEP 3: SORT with priority boost
        // ==========================================
        const priorityWeight: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        
        const scoredCandidates = candidates.map(task => {
          let score = priorityWeight[task.priority] || 1;
          
          // Boost pushed tasks (accountability)
          if (task.pushed_count && task.pushed_count > 0) {
            score += Math.min(task.pushed_count, 3); // Cap at +3
          }
          
          // Boost due-soon tasks
          if (isDueSoon(task.due_date)) {
            score += 3;
          }
          
          // Boost financial/comms tasks
          if (hasPriorityKeyword(task.title)) {
            score += 2;
          }
          
          // UP_NEXT status gets a boost
          if (task.status === 'UP_NEXT') {
            score += 1;
          }
          
          return { ...task, score };
        });

        // Sort by score descending, then by due_date ascending
        scoredCandidates.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return 0;
        });

        // Take top 20 candidates for scheduling
        const topCandidates = scoredCandidates.slice(0, 20);

        console.log(`  🎯 Top ${topCandidates.length} candidates selected:`);
        topCandidates.forEach((t, i) => {
          console.log(`    ${i + 1}. "${t.title}" (score: ${t.score}, priority: ${t.priority}, pushed: ${t.pushed_count || 0})`);
        });

        // ==========================================
        // STEP 4: Call batch-calendar-scheduler
        // ==========================================
        // Schedule for today (the scheduler runs at midnight, filling today's slots)
        const todayDate = new Date(now);
        const todayISO = todayDate.toISOString().split('T')[0];

        const schedulerPayload = {
          tasks: topCandidates.map(t => ({
            id: t.id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            estimate_minutes: t.estimate_minutes || 60,
            due_date: t.due_date,
          })),
          userId,
          timezone,
          targetDate: todayISO,
          allowOverflow: false,
        };

        console.log(`  🤖 Calling batch-calendar-scheduler for ${todayISO}...`);

        const schedulerResponse = await fetch(
          `${supabaseUrl}/functions/v1/batch-calendar-scheduler`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify(schedulerPayload),
          }
        );

        if (!schedulerResponse.ok) {
          const errText = await schedulerResponse.text();
          console.error(`❌ Scheduler error for ${userId}: ${schedulerResponse.status} ${errText}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0, error: errText };
          continue;
        }

        const schedulerResult = await schedulerResponse.json();
        const scheduled = schedulerResult.scheduled || [];

        console.log(`  ✅ Scheduled ${scheduled.length} tasks`);

        // Update tasks with their scheduled times
        for (const slot of scheduled) {
          if (!slot.taskId) continue;
          
          const { error: scheduleError } = await supabase
            .from('tasks')
            .update({
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_scheduled: true,
              status: 'TODO',
              updated_at: now.toISOString(),
            })
            .eq('id', slot.taskId);

          if (scheduleError) {
            console.error(`❌ Error scheduling task ${slot.taskId}:`, scheduleError);
          }
        }

        // ==========================================
        // STEP 5: Log the run
        // ==========================================
        await supabase.from('activity_log').insert({
          user_id: userId,
          activity_type: 'nightly_schedule_built',
          status: 'completed',
          metadata: {
            rolled_over: rolledOverCount,
            candidates_evaluated: scoredCandidates.length,
            scheduled: scheduled.length,
            target_date: todayISO,
            processing_ms: Date.now() - startTime,
          },
        });

        results[userId] = {
          rolledOver: rolledOverCount,
          candidatesEvaluated: scoredCandidates.length,
          scheduled: scheduled.length,
        };

      } catch (userError) {
        console.error(`❌ Error processing user ${userId}:`, userError);
        results[userId] = { error: String(userError) };
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n🌙 Nightly schedule builder complete in ${totalTime}ms`);
    console.log('Results:', JSON.stringify(results, null, 2));

    return new Response(JSON.stringify({
      success: true,
      results,
      processingTimeMs: totalTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Nightly schedule builder failed:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
