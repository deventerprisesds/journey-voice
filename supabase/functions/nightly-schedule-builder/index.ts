import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DEFAULT_TIME_WINDOWS, DEFAULT_CATEGORY_MAPPINGS, resolveConfig, validateTaskWindow } from "../_shared/scheduling-defaults.ts";
import { getTodayInTimezone } from "../_shared/timezone.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Priority keywords that get a scheduling boost
const PRIORITY_KEYWORDS = {
  financial: ['payment', 'invoice', 'bill', 'tax', 'budget', 'contract', 'financial', 'money', 'pay', 'credit'],
  comms: ['email', 'follow up', 'follow-up', 'respond', 'reply', 'call', 'meeting', 'text', 'message', 'contact', 'coach'],
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
 * Get active windows for the target day based on user config.
 * WEEKEND ENFORCEMENT: On Saturday (6) and Sunday (0), ONLY the 'weekends'
 * window is returned, regardless of what other windows include those days.
 */
function getActiveWindows(
  timeWindows: Record<string, TimeWindow>,
  targetDayOfWeek: number
): Record<string, { start: number; end: number; totalMinutes: number }> {
  const isWeekend = targetDayOfWeek === 0 || targetDayOfWeek === 6;
  const active: Record<string, { start: number; end: number; totalMinutes: number }> = {};
  
  for (const [name, win] of Object.entries(timeWindows)) {
    if (name === 'flexible') continue; // flexible is a fallback, not a real window
    
    // WEEKEND ENFORCEMENT: On weekends, only allow the 'weekends' window
    if (isWeekend && name !== 'weekends') continue;
    // On weekdays, skip the 'weekends' window
    if (!isWeekend && name === 'weekends') continue;
    
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
      
      const { timeWindows, categoryMappings } = resolveConfig(config);
      
      console.log(`\n🌙 Processing nightly schedule for user ${userId} (${timezone})`);
      
      try {
        // ==========================================
        // STEP 0: SYNC ASSIGNMENTS (EMBA + MIT)
        // ==========================================
        try {
          console.log(`  📚 Running assignment sync for ${userId}...`);
          const syncResponse = await fetch(
            `${supabaseUrl}/functions/v1/nightly-assignment-sync`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ userId, timezone }),
            }
          );
          if (syncResponse.ok) {
            const syncResult = await syncResponse.json();
            console.log(`  📚 Assignment sync: ${syncResult.created?.length || 0} created, ${syncResult.archived?.length || 0} archived`);
          } else {
            console.warn(`  ⚠️ Assignment sync failed: ${syncResponse.status}`);
          }
        } catch (syncErr) {
          console.warn(`  ⚠️ Assignment sync error (non-fatal):`, syncErr);
        }

        // ==========================================
        // STEP 1: ROLLOVER — Reset incomplete past tasks (keep as candidates)
        // ==========================================
        const now = new Date();
        const todayISO = getTodayInTimezone(timezone);
        console.log(`  🕐 Today in ${timezone}: ${todayISO} (UTC: ${now.toISOString().split('T')[0]})`);
        
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
          // Write schedule history BEFORE clearing slots
          const historyRows = expiredTasks
            .filter(task => task.start_time)
            .map(task => ({
              task_id: task.id,
              user_id: userId,
              scheduled_date: task.start_time!.split('T')[0],
              start_time: task.start_time,
              end_time: null,
              action: 'rollover',
              pushed_count: (task.pushed_count || 0) + 1,
            }));
          if (historyRows.length > 0) {
            const { error: histError } = await supabase
              .from('task_schedule_history')
              .insert(historyRows);
            if (histError) {
              console.warn(`  ⚠️ Failed to write schedule history: ${histError.message}`);
            } else {
              console.log(`  📜 Recorded ${historyRows.length} schedule history entries`);
            }
          }

          for (const task of expiredTasks) {
            // Clear scheduling but preserve status so they flow into candidate pool
            const { error: updateError } = await supabase
              .from('tasks')
              .update({
                start_time: null,
                end_time: null,
                is_scheduled: false,
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
        // STEP 1.1: CLEAR FUTURE-SCHEDULED TASKS (rebuild, not append)
        // Tasks scheduled in the upcoming 7-day horizon are cleared so the
        // week loop can rebuild from scratch. No pushed_count increment,
        // no history — these haven't happened yet.
        // ==========================================
        const horizonEnd = new Date(now);
        horizonEnd.setDate(horizonEnd.getDate() + 7);
        
        const { data: futureTasks, error: futureError } = await supabase
          .from('tasks')
          .select('id, title, start_time')
          .eq('user_id', userId)
          .eq('is_scheduled', true)
          .not('status', 'eq', 'DONE')
          .gte('start_time', now.toISOString())
          .lt('start_time', horizonEnd.toISOString());

        let clearedFutureCount = 0;
        if (!futureError && futureTasks && futureTasks.length > 0) {
          for (const ft of futureTasks) {
            const { error: clearError } = await supabase
              .from('tasks')
              .update({
                start_time: null,
                end_time: null,
                is_scheduled: false,
                updated_at: now.toISOString(),
              })
              .eq('id', ft.id);

            if (!clearError) {
              clearedFutureCount++;
            }
          }
          console.log(`  🔄 Cleared ${clearedFutureCount} future-scheduled tasks for rebuild`);
        }

        // ==========================================
        // STEP 1.25: CLEAR SCHEDULING FROM COMPLETED TASKS
        // DONE tasks with is_scheduled=true consume capacity — clear them
        // ==========================================
        const { data: doneTasks } = await supabase
          .from('tasks')
          .select('id, title, start_time, end_time')
          .eq('user_id', userId)
          .eq('status', 'DONE')
          .eq('is_scheduled', true);

        if (doneTasks && doneTasks.length > 0) {
          // Record completed tasks in history before clearing
          const doneHistory = doneTasks
            .filter((dt: any) => dt.start_time)
            .map((dt: any) => ({
              task_id: dt.id,
              user_id: userId,
              scheduled_date: dt.start_time.split('T')[0],
              start_time: dt.start_time,
              end_time: dt.end_time || null,
              action: 'completed',
              pushed_count: 0,
            }));
          if (doneHistory.length > 0) {
            await supabase.from('task_schedule_history').insert(doneHistory);
          }

          for (const dt of doneTasks) {
            await supabase.from('tasks').update({
              start_time: null, end_time: null, is_scheduled: false,
              updated_at: now.toISOString(),
            }).eq('id', dt.id);
          }
          console.log(`  🧹 Cleared scheduling from ${doneTasks.length} completed tasks`);
        }

        // ==========================================
        // STEP 1.5: ARCHIVE STALE TASKS
        // Tasks pushed 5+ times with due_date > 30 days past are auto-archived
        // ==========================================
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const { data: staleTasks, error: staleError } = await supabase
          .from('tasks')
          .select('id, title, pushed_count, due_date, category')
          .eq('user_id', userId)
          .not('status', 'eq', 'DONE')
          .is('completed_at', null)
          .gte('pushed_count', 5)
          .lt('due_date', thirtyDaysAgo);

        let archivedStaleCount = 0;
        if (!staleError && staleTasks && staleTasks.length > 0) {
          for (const stale of staleTasks) {
            const { error: archError } = await supabase
              .from('tasks')
              .update({
                status: 'DONE',
                completed_at: now.toISOString(),
                updated_at: now.toISOString(),
                scheduling_context: {
                  archived_reason: 'stale_rollover',
                  pushed_count: stale.pushed_count,
                  original_due_date: stale.due_date,
                },
              })
              .eq('id', stale.id);

            if (!archError) {
              archivedStaleCount++;
              console.log(`  🗑️ Archived stale: "${stale.title}" (pushed ×${stale.pushed_count}, due ${stale.due_date})`);
            }
          }
        }
        if (archivedStaleCount > 0) {
          console.log(`  🗑️ Archived ${archivedStaleCount} stale tasks`);
        }

        // ==========================================
        // STEP 1.6: ARCHIVE STALE EDUCATION TASKS
        // EDUCATION tasks overdue 30+ days (regardless of pushed_count)
        // ==========================================
        const { data: staleEduTasks, error: staleEduError } = await supabase
          .from('tasks')
          .select('id, title, due_date, category')
          .eq('user_id', userId)
          .in('category', ['EDUCATION', 'PROF_EDUCATION'])
          .not('status', 'eq', 'DONE')
          .is('completed_at', null)
          .lt('due_date', thirtyDaysAgo);

        let archivedEduCount = 0;
        if (!staleEduError && staleEduTasks && staleEduTasks.length > 0) {
          for (const stale of staleEduTasks) {
            const { error: archError } = await supabase
              .from('tasks')
              .update({
                status: 'DONE',
                completed_at: now.toISOString(),
                updated_at: now.toISOString(),
                scheduling_context: {
                  archived_reason: 'stale_education',
                  original_due_date: stale.due_date,
                },
              })
              .eq('id', stale.id);

            if (!archError) {
              archivedEduCount++;
              console.log(`  🗑️ Archived stale education: "${stale.title}" (due ${stale.due_date})`);
            }
          }
        }
        if (archivedEduCount > 0) {
          console.log(`  🗑️ Archived ${archivedEduCount} stale education tasks`);
        }

        // PULL EXTERNAL CALENDAR EVENTS BEFORE SCHEDULING
        // ==========================================
        try {
          console.log(`[nightly-builder] Invoking calendar-delta-sync for user ${userId}...`);
          const { error: syncError } = await supabase.functions.invoke('calendar-delta-sync', {
            body: { user_id: userId }
          });
          if (syncError) {
            console.warn(`[nightly-builder] Delta sync warning: ${syncError.message}`);
          } else {
            console.log(`[nightly-builder] Delta sync completed for user ${userId}`);
          }
        } catch (deltaSyncErr) {
          console.warn(`[nightly-builder] Delta sync failed (non-blocking):`, deltaSyncErr);
        }

        // ==========================================
        // WEEK LOOP: Fill today through Sunday
        // ==========================================
        const scheduledTaskIds = new Set<string>();
        const scheduledTitles = new Set<string>();
        const accumulatedBusySlots: Array<{ start_time: string; end_time: string }> = [];
        
        // Rolling 7-day horizon: always schedule a full week ahead
        // This ensures Friday runs can place weekday tasks on Monday
        const totalDays = 7;
        
        let totalScheduledAcrossWeek = 0;
        const weekResults: Record<string, any> = {};

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
          const targetDate = new Date(now);
          targetDate.setDate(targetDate.getDate() + dayOffset);
          const targetISO = targetDate.toISOString().split('T')[0];
          
          // Get day of week for this target date
          const targetUserDate = new Date(targetDate.toLocaleString('en-US', { timeZone: timezone }));
          const targetDayOfWeek = targetUserDate.getDay();
          const isWeekend = targetDayOfWeek === 0 || targetDayOfWeek === 6;
          
          console.log(`\n  📅 === Day ${dayOffset + 1}/${totalDays}: ${targetISO} (day ${targetDayOfWeek}${isWeekend ? ' WEEKEND' : ''}) ===`);

          // STEP 2: COMPUTE WINDOW CAPACITY for this day
          const activeWindows = getActiveWindows(timeWindows, targetDayOfWeek);
          const activeWindowNames = Object.keys(activeWindows);
          
          if (activeWindowNames.length === 0) {
            console.log(`    ℹ️ No active time windows on day ${targetDayOfWeek}`);
            weekResults[targetISO] = { scheduled: 0, reason: 'no_active_windows' };
            continue;
          }

          console.log(`    🪟 Active windows: ${activeWindowNames.join(', ')}`);

          // Fetch already-scheduled tasks for this day
          const { data: dayScheduled } = await supabase
            .from('tasks')
            .select('start_time, end_time, estimate_minutes')
            .eq('user_id', userId)
            .eq('is_scheduled', true)
            .gte('start_time', `${targetISO}T00:00:00`)
            .lt('start_time', `${targetISO}T23:59:59`);

          // Fetch external calendar events for this day
          const { data: dayEvents } = await supabase
            .from('external_calendar_events')
            .select('start_time, end_time')
            .eq('user_id', userId)
            .gte('start_time', `${targetISO}T00:00:00`)
            .lt('start_time', `${targetISO}T23:59:59`)
            .eq('is_all_day', false);

          // Include accumulated busy slots from previous days' scheduling
          const dayBusySlots = accumulatedBusySlots.filter(s => s.start_time.startsWith(targetISO));

          const allScheduledItems = [
            ...(dayScheduled || []),
            ...(dayEvents || []).map(e => ({ ...e, estimate_minutes: undefined })),
            ...dayBusySlots.map(s => ({ ...s, estimate_minutes: undefined })),
          ];

          const windowCapacities = computeUsedMinutes(allScheduledItems, activeWindows, targetISO, timezone);
          
          const totalRemainingMinutes = Object.values(windowCapacities).reduce(
            (sum, wc) => sum + wc.remainingMinutes, 0
          );

          console.log(`    📊 Window capacities for ${targetISO}:`);
          for (const [name, cap] of Object.entries(windowCapacities)) {
            console.log(`      ${name}: ${cap.remainingMinutes}/${cap.totalMinutes} min remaining`);
          }

          if (totalRemainingMinutes <= 0) {
            console.log(`    ℹ️ No remaining capacity for ${targetISO}`);
            weekResults[targetISO] = { scheduled: 0, reason: 'no_capacity' };
            continue;
          }

          // STEP 3: GATHER CANDIDATES (excluding already-scheduled ones)
          const { data: mappedTasks, error: mappedError } = await supabase
            .from('tasks')
            .select('id, task_topic_mappings!inner(topic_id)')
            .eq('user_id', userId)
            .is('completed_at', null)
            .not('status', 'in', '("DONE","BLOCKED")');

          if (mappedError) {
            console.warn(`    ⚠️ Error fetching topic mappings:`, mappedError);
          }

          const mappedIds = (mappedTasks || []).map((t: any) => t.id);

          const { data: readyUpNextTasks } = await supabase
            .from('tasks')
            .select('id')
            .eq('user_id', userId)
            .in('status', ['READY', 'UP_NEXT', 'TODO', 'BACKLOG'])
            .is('is_scheduled', false)
            .is('completed_at', null)
            .not('title', 'ilike', '%Test Task%');

          const readyIds = (readyUpNextTasks || []).map((t: any) => t.id);
          const allCandidateIds = [...new Set([...mappedIds, ...readyIds])]
            .filter(id => !scheduledTaskIds.has(id)); // Exclude already-scheduled

          if (allCandidateIds.length === 0) {
            console.log(`    ℹ️ No candidates remaining for ${targetISO}`);
            weekResults[targetISO] = { scheduled: 0, reason: 'no_candidates' };
            continue;
          }

          const { data: candidates } = await supabase
            .from('tasks')
            .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status')
            .in('id', allCandidateIds)
            .not('status', 'in', '("DONE","BLOCKED")')
            .not('title', 'ilike', '%Test Task%')
            .is('is_scheduled', false)
            .is('completed_at', null)
            .order('created_at', { ascending: true });

          if (!candidates || candidates.length === 0) {
            console.log(`    ℹ️ No unscheduled candidates for ${targetISO}`);
            weekResults[targetISO] = { scheduled: 0 };
            continue;
          }

          // STEP 4: SCORE and FILL by window capacity (with dedup)
          const priorityWeight: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
          
          const scoredCandidates = candidates
            .filter(t => !scheduledTitles.has(t.title)) // Dedup by title
            .map(task => {
              let score = priorityWeight[task.priority] || 1;
              
              // Priority board boost (strongest signal)
              if (mappedIds.includes(task.id)) score += 10;
              
              // Pushed count: diminishing returns after 3
              if (task.pushed_count && task.pushed_count > 0) {
                if (task.pushed_count <= 3) {
                  score += task.pushed_count; // +1, +2, +3
                } else {
                  score += 3; // cap the bonus at 3
                  score -= (task.pushed_count - 3); // then penalize staleness
                }
              }
              
              // Due soon boost
              if (isDueSoon(task.due_date)) score += 3;
              
              // Boost only if due within 7 days (not blanket overdue boost)
              if (task.due_date) {
                const dueDate = new Date(task.due_date);
                const sevenDaysOut = new Date(targetDate.getTime() + 7 * 86400000);
                if (dueDate >= targetDate && dueDate <= sevenDaysOut) score += 5;
              }
              
              // Intent-based keyword boost (financial, comms) — strong signal
              if (hasPriorityKeyword(task.title)) score += 5;
              
              // Status boost
              if (task.status === 'UP_NEXT') score += 1;
              
              // Staleness penalty: overdue tasks get penalized
              if (task.due_date) {
                const dueDate = new Date(task.due_date);
                const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                const thirtyDaysAgoDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                if (dueDate < thirtyDaysAgoDate) {
                  score -= 10;
                  console.log(`      📉 Heavy staleness penalty for "${task.title}" (due ${task.due_date}, 30+ days overdue)`);
                } else if (dueDate < fourteenDaysAgo) {
                  score -= 3;
                  console.log(`      📉 Staleness penalty for "${task.title}" (due ${task.due_date})`);
                }
              }
              
              return { ...task, score: Math.max(score, 0), isPriorityBoard: mappedIds.includes(task.id) };
            });

          scoredCandidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            if (a.due_date) return -1;
            if (b.due_date) return 1;
            return 0;
          });

          const selectedCandidates: typeof scoredCandidates = [];
          const windowRemaining = { ...Object.fromEntries(
            Object.entries(windowCapacities).map(([name, cap]) => [name, cap.remainingMinutes])
          )};

          for (const task of scoredCandidates) {
            const duration = task.estimate_minutes || 
              categoryMappings[task.category]?.estimatedDuration || 60;
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
              console.log(`    ⚠️ "${task.title}" doesn't fit any allowed window — skipping`);
            }

            const totalRemaining = Object.values(windowRemaining).reduce((s, v) => s + v, 0);
            if (totalRemaining <= 0) break;
          }

          console.log(`    🎯 ${selectedCandidates.length} candidates selected for ${targetISO}`);
          selectedCandidates.forEach((t, i) => {
            console.log(`      ${i + 1}. "${t.title}" (score: ${t.score}, est: ${t.estimate_minutes || 60}m, board: ${t.isPriorityBoard})`);
          });

          if (selectedCandidates.length === 0) {
            weekResults[targetISO] = { scheduled: 0, reason: 'no_fit' };
            continue;
          }

          // STEP 5: Call batch-calendar-scheduler
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
            targetDate: targetISO,
            allowOverflow: false,
            windowCapacity: Object.fromEntries(
              Object.entries(windowCapacities).map(([name, cap]) => [
                name,
                { totalMinutes: cap.totalMinutes, remainingMinutes: cap.remainingMinutes, start: activeWindows[name].start, end: activeWindows[name].end }
              ])
            ),
          };

          console.log(`    🤖 Calling batch-calendar-scheduler for ${targetISO} with ${selectedCandidates.length} tasks...`);

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
            console.error(`    ❌ Scheduler error: ${schedulerResponse.status} ${errText}`);
            weekResults[targetISO] = { scheduled: 0, error: errText };
            continue;
          }

          const schedulerResult = await schedulerResponse.json();
          const scheduled = schedulerResult.scheduled || [];

          console.log(`    ✅ Scheduler returned ${scheduled.length} slots`);

          // Update tasks with their scheduled times
          let actuallyScheduled = 0;
          for (const slot of scheduled) {
            if (!slot.taskId || !slot.start_time || !slot.end_time) {
              console.log(`    ⏭️ Skipping task ${slot.taskId || 'unknown'}: no valid time slot`);
              continue;
            }
            
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
              console.error(`    ❌ Error scheduling task ${slot.taskId}:`, scheduleError);
            } else {
              actuallyScheduled++;
              scheduledTaskIds.add(slot.taskId);
              scheduledTitles.add(candidate?.title || '');
              accumulatedBusySlots.push({ start_time: slot.start_time, end_time: slot.end_time });
            }
          }
          
          totalScheduledAcrossWeek += actuallyScheduled;
          weekResults[targetISO] = { scheduled: actuallyScheduled, candidates: selectedCandidates.length };
          console.log(`    ✅ Actually scheduled ${actuallyScheduled}/${scheduled.length} tasks for ${targetISO}`);
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
            archived_stale: archivedStaleCount,
            total_scheduled: totalScheduledAcrossWeek,
            days_processed: totalDays,
            week_results: weekResults,
            processing_ms: Date.now() - startTime,
          },
        });

        results[userId] = {
          rolledOver: rolledOverCount,
          archivedStale: archivedStaleCount,
          totalScheduled: totalScheduledAcrossWeek,
          daysProcessed: totalDays,
          weekResults,
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
