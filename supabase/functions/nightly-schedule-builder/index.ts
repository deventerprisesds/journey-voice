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

// ==========================================
// CAPACITY HELPERS
// ==========================================

interface TimeWindow {
  start: number; // hour (0-23)
  end: number;   // hour (0-23)
  days: number[]; // 0=Sun, 1=Mon, ...6=Sat
}

interface WindowCapacity {
  totalMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
}

/**
 * Get active windows for the target day based on user config,
 * then compute remaining capacity by subtracting already-scheduled items.
 */
function getActiveWindows(
  timeWindows: Record<string, TimeWindow>,
  targetDayOfWeek: number
): Record<string, { start: number; end: number; totalMinutes: number }> {
  const active: Record<string, { start: number; end: number; totalMinutes: number }> = {};
  for (const [name, win] of Object.entries(timeWindows)) {
    if (name === 'flexible') continue; // flexible is a fallback, not a real window
    if (!win.days || !win.days.includes(targetDayOfWeek)) continue;
    const total = (win.end - win.start) * 60;
    if (total > 0) {
      active[name] = { start: win.start, end: win.end, totalMinutes: total };
    }
  }
  return active;
}

/**
 * Calculate how many minutes of each window are already occupied
 * by scheduled tasks (start_time/end_time overlap).
 */
function computeUsedMinutes(
  scheduledTasks: Array<{ start_time: string; end_time: string; estimate_minutes?: number }>,
  windows: Record<string, { start: number; end: number; totalMinutes: number }>,
  targetDateStr: string, // YYYY-MM-DD
  timezone: string
): Record<string, WindowCapacity> {
  const capacities: Record<string, WindowCapacity> = {};

  for (const [name, win] of Object.entries(windows)) {
    capacities[name] = {
      totalMinutes: win.totalMinutes,
      usedMinutes: 0,
      remainingMinutes: win.totalMinutes,
    };
  }

  for (const task of scheduledTasks) {
    if (!task.start_time || !task.end_time) continue;
    const taskStart = new Date(task.start_time);
    const taskEnd = new Date(task.end_time);
    const taskDuration = (taskEnd.getTime() - taskStart.getTime()) / 60000;

    // Determine which hour the task starts in (in user's timezone)
    const taskHour = parseInt(
      taskStart.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
    );

    // Find the window this task falls into
    for (const [name, win] of Object.entries(windows)) {
      if (taskHour >= win.start && taskHour < win.end) {
        capacities[name].usedMinutes += taskDuration;
        capacities[name].remainingMinutes = Math.max(
          0,
          capacities[name].totalMinutes - capacities[name].usedMinutes
        );
        break;
      }
    }
  }

  return capacities;
}

/**
 * Determine the best window for a task based on its category and the user's categoryMappings.
 * Returns ordered list of preferred windows.
 */
function getPreferredWindows(
  category: string,
  categoryMappings: Record<string, { defaultTimeWindow?: string[] }>,
  activeWindowNames: string[]
): string[] {
  const mapping = categoryMappings[category];
  if (!mapping?.defaultTimeWindow) return activeWindowNames; // fallback to any
  
  // Filter to only windows that are active today, preserving preference order
  const preferred = mapping.defaultTimeWindow.filter(
    (w: string) => w !== 'flexible' && activeWindowNames.includes(w)
  );
  
  // If none of the preferred windows are active today, fall back to all active
  return preferred.length > 0 ? preferred : activeWindowNames;
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
      const config = userPref.config || {};
      
      // Default time windows if user hasn't configured any
      const DEFAULT_TIME_WINDOWS: Record<string, TimeWindow> = {
        morning: { start: 6, end: 9, days: [1, 2, 3, 4, 5] },
        business_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
        after_work: { start: 17, end: 22, days: [1, 2, 3, 4, 5, 6] },
        evening: { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
        weekends: { start: 10, end: 20, days: [0, 6] },
      };
      
      const DEFAULT_CATEGORY_MAPPINGS: Record<string, any> = {
        LIFE: { defaultTimeWindow: ['morning', 'after_work', 'weekends'], estimatedDuration: 30, defaultStatus: 'TODO' },
        EDUCATION: { defaultTimeWindow: ['after_work', 'evening'], estimatedDuration: 75, defaultStatus: 'TODO' },
        VENTURES: { defaultTimeWindow: ['business_hours', 'after_work'], estimatedDuration: 60, defaultStatus: 'TODO' },
        CAREER: { defaultTimeWindow: ['business_hours'], estimatedDuration: 60, defaultStatus: 'TODO' },
        PROF_EDUCATION: { defaultTimeWindow: ['business_hours', 'after_work'], estimatedDuration: 90, defaultStatus: 'TODO' },
      };
      
      const timeWindows: Record<string, TimeWindow> = (config.timeWindows && Object.keys(config.timeWindows).length > 0)
        ? config.timeWindows
        : DEFAULT_TIME_WINDOWS;
      const categoryMappings: Record<string, any> = (config.categoryMappings && Object.keys(config.categoryMappings).length > 0)
        ? config.categoryMappings
        : DEFAULT_CATEGORY_MAPPINGS;
      
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
        // STEP 2: COMPUTE WINDOW CAPACITY
        // ==========================================
        const todayDate = new Date(now);
        const todayISO = todayDate.toISOString().split('T')[0];
        // Get day of week in user's timezone
        const targetDayOfWeek = parseInt(
          now.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' })
            .length > 0
            ? new Date(now.toLocaleString('en-US', { timeZone: timezone })).getDay().toString()
            : '0'
        );

        const activeWindows = getActiveWindows(timeWindows, targetDayOfWeek);
        const activeWindowNames = Object.keys(activeWindows);
        
        if (activeWindowNames.length === 0) {
          console.log(`  ℹ️ No active time windows for ${userId} on day ${targetDayOfWeek}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0, reason: 'no_active_windows' };
          continue;
        }

        // Fetch already-scheduled tasks for today to compute used capacity
        const { data: todayScheduled } = await supabase
          .from('tasks')
          .select('start_time, end_time, estimate_minutes')
          .eq('user_id', userId)
          .eq('is_scheduled', true)
          .gte('start_time', `${todayISO}T00:00:00`)
          .lt('start_time', `${todayISO}T23:59:59`);

        // Also fetch external calendar events for today
        const { data: todayEvents } = await supabase
          .from('external_calendar_events')
          .select('start_time, end_time')
          .eq('user_id', userId)
          .gte('start_time', `${todayISO}T00:00:00`)
          .lt('start_time', `${todayISO}T23:59:59`)
          .eq('is_all_day', false);

        const allScheduledItems = [
          ...(todayScheduled || []),
          ...(todayEvents || []).map(e => ({ ...e, estimate_minutes: undefined })),
        ];

        const windowCapacities = computeUsedMinutes(allScheduledItems, activeWindows, todayISO, timezone);
        
        const totalRemainingMinutes = Object.values(windowCapacities).reduce(
          (sum, wc) => sum + wc.remainingMinutes, 0
        );

        console.log(`  📊 Window capacities for ${todayISO} (day ${targetDayOfWeek}):`);
        for (const [name, cap] of Object.entries(windowCapacities)) {
          console.log(`    ${name}: ${cap.remainingMinutes}/${cap.totalMinutes} min remaining`);
        }

        if (totalRemainingMinutes <= 0) {
          console.log(`  ℹ️ No remaining capacity for ${userId} today`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0, reason: 'no_capacity' };
          continue;
        }

        // ==========================================
        // STEP 3: GATHER CANDIDATES from priority board + READY/UP_NEXT
        // ==========================================
        // Query tasks that have topic mappings (priority board members)
        const { data: mappedTasks, error: mappedError } = await supabase
          .from('tasks')
          .select('id, task_topic_mappings!inner(topic_id)')
          .eq('user_id', userId)
          .is('completed_at', null)
          .not('status', 'in', '("DONE","BLOCKED")');

        if (mappedError) {
          console.warn(`⚠️ Error fetching topic mappings for ${userId}, falling back to READY/UP_NEXT only:`, mappedError);
        }

        const mappedIds = (mappedTasks || []).map((t: any) => t.id);

        // Also fetch READY/UP_NEXT/TODO tasks regardless of priority board membership
        const { data: readyUpNextTasks, error: readyError } = await supabase
          .from('tasks')
          .select('id')
          .eq('user_id', userId)
          .in('status', ['READY', 'UP_NEXT', 'TODO', 'BACKLOG'])
          .is('is_scheduled', false)
          .is('completed_at', null)
          .not('title', 'ilike', '%Test Task%');

        if (readyError) {
          console.error(`❌ Error fetching READY/UP_NEXT tasks for ${userId}:`, readyError);
        }

        // Merge and deduplicate candidate IDs
        const readyIds = (readyUpNextTasks || []).map((t: any) => t.id);
        const allCandidateIds = [...new Set([...mappedIds, ...readyIds])];

        if (allCandidateIds.length === 0) {
          console.log(`  ℹ️ No candidates (priority board or READY/UP_NEXT) for ${userId}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0 };
          continue;
        }

        // Fetch ALL eligible candidates (no arbitrary limit)
        const { data: candidates, error: candidatesError } = await supabase
          .from('tasks')
          .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status')
          .in('id', allCandidateIds)
          .not('status', 'in', '("DONE","BLOCKED")')
          .not('title', 'ilike', '%Test Task%')
          .is('is_scheduled', false)
          .is('completed_at', null)
          .order('created_at', { ascending: true });

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
        // STEP 4: SCORE and FILL by window capacity
        // ==========================================
        const priorityWeight: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        
        const scoredCandidates = candidates.map(task => {
          let score = priorityWeight[task.priority] || 1;
          
          // Priority board boost (+10) — always outranks non-board tasks
          if (mappedIds.includes(task.id)) {
            score += 10;
          }
          
          // Boost pushed tasks (accountability)
          if (task.pushed_count && task.pushed_count > 0) {
            score += Math.min(task.pushed_count, 3);
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
          
          return { ...task, score, isPriorityBoard: mappedIds.includes(task.id) };
        });

        // Sort by score descending, then by due_date ascending
        scoredCandidates.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return 0;
        });

        // Walk through scored candidates, assign to windows until capacity is full
        const selectedCandidates: typeof scoredCandidates = [];
        const windowRemaining = { ...Object.fromEntries(
          Object.entries(windowCapacities).map(([name, cap]) => [name, cap.remainingMinutes])
        )};

        for (const task of scoredCandidates) {
          const duration = task.estimate_minutes || 
            categoryMappings[task.category]?.estimatedDuration || 
            60;
          
          // Find the best window for this task
          const preferredWindows = getPreferredWindows(task.category, categoryMappings, activeWindowNames);
          
          let assigned = false;
          for (const winName of preferredWindows) {
            if ((windowRemaining[winName] || 0) >= duration) {
              windowRemaining[winName] -= duration;
              selectedCandidates.push(task);
              assigned = true;
              break;
            }
          }

          if (!assigned) {
            // Try any window with capacity as a last resort
            for (const winName of activeWindowNames) {
              if ((windowRemaining[winName] || 0) >= duration) {
                windowRemaining[winName] -= duration;
                selectedCandidates.push(task);
                assigned = true;
                break;
              }
            }
          }

          // Check if all windows are full
          const totalRemaining = Object.values(windowRemaining).reduce((s, v) => s + v, 0);
          if (totalRemaining <= 0) break;
        }

        console.log(`  🎯 ${selectedCandidates.length} candidates selected to fill capacity (from ${scoredCandidates.length} evaluated):`);
        selectedCandidates.forEach((t, i) => {
          console.log(`    ${i + 1}. "${t.title}" (score: ${t.score}, est: ${t.estimate_minutes || 60}m, board: ${t.isPriorityBoard})`);
        });
        console.log(`  📊 Window fill status after selection:`);
        for (const [name, remaining] of Object.entries(windowRemaining)) {
          const cap = windowCapacities[name];
          console.log(`    ${name}: ${remaining}/${cap.totalMinutes} min remaining`);
        }

        if (selectedCandidates.length === 0) {
          console.log(`  ℹ️ No candidates fit available capacity for ${userId}`);
          results[userId] = { rolledOver: rolledOverCount, scheduled: 0, reason: 'no_fit' };
          continue;
        }

        // ==========================================
        // STEP 5: Call batch-calendar-scheduler with capacity context
        // ==========================================
        const schedulerPayload = {
          tasks: selectedCandidates.map(t => ({
            id: t.id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            estimate_minutes: t.estimate_minutes || categoryMappings[t.category]?.estimatedDuration || 60,
            due_date: t.due_date,
          })),
          userId,
          timezone,
          targetDate: todayISO,
          allowOverflow: false,
          windowCapacity: Object.fromEntries(
            Object.entries(windowCapacities).map(([name, cap]) => [
              name,
              { totalMinutes: cap.totalMinutes, remainingMinutes: cap.remainingMinutes, start: activeWindows[name].start, end: activeWindows[name].end }
            ])
          ),
        };

        console.log(`  🤖 Calling batch-calendar-scheduler for ${todayISO} with ${selectedCandidates.length} tasks...`);

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

        // Update tasks with their scheduled times, preserving pre-schedule status
        for (const slot of scheduled) {
          if (!slot.taskId) continue;
          
          const candidate = selectedCandidates.find(c => c.id === slot.taskId);
          const preScheduleStatus = candidate?.status || 'TODO';
          
          const { error: scheduleError } = await supabase
            .from('tasks')
            .update({
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_scheduled: true,
              scheduling_context: { pre_schedule_status: preScheduleStatus },
              status: 'TODO',
              updated_at: now.toISOString(),
            })
            .eq('id', slot.taskId);

          if (scheduleError) {
            console.error(`❌ Error scheduling task ${slot.taskId}:`, scheduleError);
          }
        }

        // ==========================================
        // STEP 6: Log the run
        // ==========================================
        await supabase.from('activity_log').insert({
          user_id: userId,
          activity_type: 'nightly_schedule_built',
          status: 'completed',
          metadata: {
            rolled_over: rolledOverCount,
            candidates_evaluated: scoredCandidates.length,
            candidates_selected: selectedCandidates.length,
            scheduled: scheduled.length,
            target_date: todayISO,
            window_capacities: Object.fromEntries(
              Object.entries(windowCapacities).map(([name, cap]) => [
                name, `${cap.remainingMinutes}/${cap.totalMinutes}`
              ])
            ),
            processing_ms: Date.now() - startTime,
          },
        });

        results[userId] = {
          rolledOver: rolledOverCount,
          candidatesEvaluated: scoredCandidates.length,
          candidatesSelected: selectedCandidates.length,
          scheduled: scheduled.length,
          windowCapacities: Object.fromEntries(
            Object.entries(windowCapacities).map(([name, cap]) => [
              name, { remaining: cap.remainingMinutes, total: cap.totalMinutes }
            ])
          ),
        };

      } catch (userError) {
        const errMsg = userError instanceof Error ? userError.message : String(userError);
        const errStack = userError instanceof Error ? userError.stack : 'no stack';
        console.error(`❌ Error processing user ${userId}: ${errMsg}`);
        console.error(`  Stack trace: ${errStack}`);
        
        // Log the failure so it's visible in activity_log
        try {
          await supabase.from('activity_log').insert({
            user_id: userId,
            activity_type: 'nightly_schedule_built',
            status: 'error',
            metadata: { error: errMsg, stack: errStack, processing_ms: Date.now() - startTime },
          });
        } catch (_) { /* best effort */ }
        
        results[userId] = { error: errMsg, stack: errStack };
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
