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

/**
 * Delete app-originated calendar events for tasks being cleared/rescheduled.
 * Only deletes events where source_task_id is set (app → calendar).
 * Events synced from external calendars (source_task_id = NULL) are untouched.
 */
async function deleteAppOriginatedEvents(
  supabase: any,
  userId: string,
  tasks: Array<{ id: string; external_event_id?: string | null }>
) {
  const tasksWithEvents = tasks.filter(t => t.external_event_id);
  if (tasksWithEvents.length === 0) return;

  const taskIds = tasksWithEvents.map(t => t.id);
  const { data: appEvents, error } = await supabase
    .from('external_calendar_events')
    .select('id, external_event_id, connection_id, source_task_id')
    .in('source_task_id', taskIds);

  if (error || !appEvents || appEvents.length === 0) {
    if (error) console.warn(`  ⚠️ Failed to look up app events:`, error.message);
    return;
  }

  console.log(`  🗓️ Found ${appEvents.length} app-originated calendar events to delete`);

  const fnUrl = Deno.env.get('SUPABASE_URL')!;
  const fnKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  for (const evt of appEvents) {
    try {
      const response = await fetch(`${fnUrl}/functions/v1/calendar-integration-manager`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${fnKey}`,
        },
        body: JSON.stringify({
          action: 'delete_event',
          task_id: evt.source_task_id,
          user_id: userId,
          connection_id: evt.connection_id,
        }),
      });
      if (response.ok) {
        console.log(`  🗓️ Deleted calendar event for task ${evt.source_task_id}`);
      } else {
        console.warn(`  ⚠️ Calendar event delete returned ${response.status}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ Failed to delete calendar event (non-fatal):`, err);
    }
  }
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

/**
 * Inspect a task title for contextRules keyword matches and return the
 * preferred window that should override the category default, if any.
 *
 * Example: "Go to the mall" → matches "shopping" → returns "after_work".
 * This prevents nonsensical placements like errands at 9pm.
 *
 * Returns { window, matchedKeyword } when a match is found AND the resulting
 * window is in the active window set for the day. Returns null otherwise.
 */
function getKeywordWindowOverride(
  title: string,
  contextKeywords: Record<string, string[]> | undefined,
  activeWindowNames: string[]
): { window: string; matchedKeyword: string } | null {
  if (!contextKeywords || !title) return null;
  const lower = title.toLowerCase();

  for (const [keyword, mapping] of Object.entries(contextKeywords)) {
    // mapping is [timeWindow, status] per schedulingRules.ts
    if (!Array.isArray(mapping) || mapping.length === 0) continue;
    const targetWindow = mapping[0];
    if (!targetWindow || targetWindow === 'flexible') continue;

    // Match by word boundary (and underscore→space variant for keys like "follow_up")
    const kw = keyword.toLowerCase().replace(/_/g, ' ');
    if (kw.length < 3) continue;
    if (lower.includes(kw)) {
      if (activeWindowNames.includes(targetWindow)) {
        return { window: targetWindow, matchedKeyword: keyword };
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Parse optional request body for single-day / single-user mode
    let body: any = {};
    try { body = await req.json(); } catch { /* no body = full run */ }
    const requestedUserId: string | undefined = body?.userId;
    const singleDay: boolean = body?.singleDay === true;
    const triggerSource: string = typeof body?.triggerSource === 'string'
      ? body.triggerSource
      : (singleDay ? 'manual_reschedule' : 'cron');

    if (singleDay) console.log(`⚡ Single-day mode requested${requestedUserId ? ` for user ${requestedUserId}` : ''} (trigger: ${triggerSource})`);

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

    // If a specific user was requested, filter to just them
    const filteredUsers = requestedUserId
      ? users.filter((u: any) => u.user_id === requestedUserId)
      : users;

    if (filteredUsers.length === 0) {
      return new Response(JSON.stringify({ message: `User ${requestedUserId} not found in scheduling prefs` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Record<string, any> = {};

    for (const userPref of filteredUsers) {
      const userId = userPref.user_id;
      const timezone = userPref.timezone || 'America/New_York';
      const config = userPref.config || {};

      const { timeWindows, categoryMappings } = resolveConfig(config);
      // contextRules.keywords drives keyword-based window overrides
      // (e.g. "mall" → after_work, even if category LIFE allows flexible 9-22)
      const contextKeywords: Record<string, string[]> | undefined =
        (config?.contextRules?.keywords) || undefined;

      // Per-user run identity + structured trace
      const runId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const steps: Array<{ step: string; inputs: Record<string, unknown>; outputs: Record<string, unknown>; durationMs: number }> = [];
      const pushStep = (step: string, inputs: Record<string, unknown>, outputs: Record<string, unknown>, t0: number) => {
        steps.push({ step, inputs, outputs, durationMs: Date.now() - t0 });
      };

      console.log(`\n🌙 Processing nightly schedule for user ${userId} (${timezone}) — runId=${runId} trigger=${triggerSource}`);

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
        // In single-day mode, only clear TODAY's tasks. In full mode, clear entire 7-day horizon.
        // ==========================================
        if (!singleDay) {
          const horizonEnd = new Date(now);
          horizonEnd.setDate(horizonEnd.getDate() + 7);
          
          const { data: futureTasks, error: futureError } = await supabase
            .from('tasks')
            .select('id, title, start_time, external_event_id')
            .eq('user_id', userId)
            .eq('is_scheduled', true)
            .not('status', 'eq', 'DONE')
            .gte('start_time', now.toISOString())
            .lt('start_time', horizonEnd.toISOString());

          let clearedFutureCount = 0;
          if (!futureError && futureTasks && futureTasks.length > 0) {
            // Delete app-originated calendar events before clearing
            await deleteAppOriginatedEvents(supabase, userId, futureTasks);

            for (const ft of futureTasks) {
              const { error: clearError } = await supabase
                .from('tasks')
                .update({
                  start_time: null,
                  end_time: null,
                  is_scheduled: false,
                  external_event_id: null,
                  updated_at: now.toISOString(),
                })
                .eq('id', ft.id);

              if (!clearError) {
                clearedFutureCount++;
              }
            }
            console.log(`  🔄 Cleared ${clearedFutureCount} future-scheduled tasks for rebuild`);
          }
        } else {
          // Single-day: only clear today's scheduled tasks
          const [tY, tM, tD] = todayISO.split('-').map(Number);
          const todayStartUtc = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0));
          const todayEndUtc = new Date(Date.UTC(tY, tM - 1, tD + 1, 23, 59, 59));
          
          const { data: todayTasks, error: todayError } = await supabase
            .from('tasks')
            .select('id, title, start_time, external_event_id')
            .eq('user_id', userId)
            .eq('is_scheduled', true)
            .not('status', 'eq', 'DONE')
            .gte('start_time', todayStartUtc.toISOString())
            .lt('start_time', todayEndUtc.toISOString());

          let clearedTodayCount = 0;
          if (!todayError && todayTasks && todayTasks.length > 0) {
            // Delete app-originated calendar events before clearing
            await deleteAppOriginatedEvents(supabase, userId, todayTasks);

            for (const ft of todayTasks) {
              const { error: clearError } = await supabase
                .from('tasks')
                .update({
                  start_time: null,
                  end_time: null,
                  is_scheduled: false,
                  external_event_id: null,
                  updated_at: now.toISOString(),
                })
                .eq('id', ft.id);

              if (!clearError) {
                clearedTodayCount++;
              }
            }
            console.log(`  🔄 [single-day] Cleared ${clearedTodayCount} today-scheduled tasks for rebuild`);
          }

          // Also purge pending notifications for today
          try {
            await supabase
              .from('scheduled_notifications')
              .delete()
              .eq('user_id', userId)
              .eq('status', 'pending')
              .gte('send_at', todayStartUtc.toISOString())
              .lt('send_at', todayEndUtc.toISOString());
            console.log(`  🔔 Purged pending notifications for today`);
          } catch (notifErr) {
            console.warn(`  ⚠️ Failed to purge notifications (non-fatal):`, notifErr);
          }
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
        // STEP 1.6: ARCHIVE STALE EDUCATION TASKS (non-assignment only)
        // Assignment-linked tasks are NEVER auto-archived — they stay visible as overdue
        // ==========================================
        const { data: staleEduTasks, error: staleEduError } = await supabase
          .from('tasks')
          .select('id, title, due_date, category, assignment_id')
          .eq('user_id', userId)
          .in('category', ['EDUCATION', 'PROF_EDUCATION'])
          .not('status', 'eq', 'DONE')
          .is('completed_at', null)
          .is('assignment_id', null)
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
          console.log(`  🗑️ Archived ${archivedEduCount} stale education tasks (non-assignment only)`);
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
        
        // Rolling 7-day horizon (or 1 day in single-day mode)
        const totalDays = singleDay ? 1 : 7;
        
        let totalScheduledAcrossWeek = 0;
        const weekResults: Record<string, any> = {};

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
          // Compute target date from todayISO (timezone-correct) to avoid UTC drift
          const [tY, tM, tD] = todayISO.split('-').map(Number);
          const targetDate = new Date(tY, tM - 1, tD + dayOffset);
          const targetISO = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
          
          // targetDate is already in local calendar space (constructed from todayISO)
          const targetDayOfWeek = targetDate.getDay();
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
          // Use timezone-aware UTC bounds for querying this local day
          const { localDateToUtcBounds } = await import('../_shared/timezone.ts');
          const dayBounds = localDateToUtcBounds(targetISO, timezone);

          const { data: dayScheduled } = await supabase
            .from('tasks')
            .select('start_time, end_time, estimate_minutes')
            .eq('user_id', userId)
            .eq('is_scheduled', true)
            .gte('start_time', dayBounds.start)
            .lt('start_time', dayBounds.end);

          // Fetch external calendar events for this day
          const { data: dayEvents } = await supabase
            .from('external_calendar_events')
            .select('start_time, end_time')
            .eq('user_id', userId)
            .gte('start_time', dayBounds.start)
            .lt('start_time', dayBounds.end)
            .eq('is_all_day', false);

          // Include accumulated busy slots from previous days' scheduling
          // Use dayBounds for proper timezone-aware filtering instead of UTC string prefix match
          const dayBusySlots = accumulatedBusySlots.filter(s => s.start_time >= dayBounds.start && s.start_time < dayBounds.end);

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
            .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status, assignment_id, is_priority, priority_rank, created_at')
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
          
          // Same-day title dedup: normalize and keep highest-scored only
          const seenTitlesThisDay = new Set<string>();
          const scoredCandidates = candidates
            .filter(t => !scheduledTitles.has(t.title)) // Cross-day dedup by title
            .map(task => {
              let score = priorityWeight[task.priority] || 1;
              
              // Explicit user priority — base +10, rank bonus up to +5
              if ((task as any).is_priority) {
                score += 10 + Math.max(5 - ((task as any).priority_rank ?? 0), 0);
              }
              
              // Topic-mapped — organizational nudge only (not the same as user priority)
              if (mappedIds.includes(task.id)) score += 2;
              
              // Pushed count: diminishing returns after 3
              if (task.pushed_count && task.pushed_count > 0) {
                if (task.pushed_count <= 3) {
                  score += task.pushed_count; // +1, +2, +3
                } else {
                  score += 3; // cap the bonus at 3
                  score -= (task.pushed_count - 3); // then penalize staleness
                }
              }
              
              // Urgency ladder: ±48h includes overdue (intentional)
              if (isDueSoon(task.due_date)) score += 5;
              
              // 3-7 day window (only if NOT already in the 48h window)
              if (task.due_date) {
                const dueDate = new Date(task.due_date);
                const twoDaysOut = new Date(targetDate.getTime() + 2 * 86400000);
                const sevenDaysOut = new Date(targetDate.getTime() + 7 * 86400000);
                if (dueDate > twoDaysOut && dueDate <= sevenDaysOut) score += 3;
              }
              
              // Intent-based keyword boost (financial, comms) — strong signal
              if (hasPriorityKeyword(task.title)) score += 5;
              
              // Status boost
              if (task.status === 'UP_NEXT') score += 1;
              
              // Recency boost for recently created tasks
              const createdAt = new Date((task as any).created_at);
              const daysSinceCreated = (Date.now() - createdAt.getTime()) / 86400000;
              if (daysSinceCreated <= 3) score += 2;
              else if (daysSinceCreated <= 7) score += 1;
              
              // Assignment grace period: 0-7 days overdue → boost to URGENT
              if ((task as any).assignment_id && task.due_date) {
                const dueDate = new Date(task.due_date);
                if (dueDate < targetDate) {
                  const daysOverdue = Math.floor((targetDate.getTime() - dueDate.getTime()) / 86400000);
                  if (daysOverdue <= 7) {
                    score += 10;
                    (task as any)._overridePriority = 'URGENT';
                    console.log(`      🚨 Assignment grace period: "${task.title}" (due ${task.due_date}, ${daysOverdue} days overdue)`);
                  }
                }
              }

              // Staleness penalty: overdue tasks get penalized (skip assignments in grace period)
              if (task.due_date) {
                const dueDate = new Date(task.due_date);
                const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                const thirtyDaysAgoDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                const daysOverdue = dueDate < targetDate ? Math.floor((targetDate.getTime() - dueDate.getTime()) / 86400000) : 0;
                const isAssignmentInGrace = (task as any).assignment_id && daysOverdue > 0 && daysOverdue <= 7;
                if (!isAssignmentInGrace) {
                  if (dueDate < thirtyDaysAgoDate) {
                    score -= 10;
                    console.log(`      📉 Heavy staleness penalty for "${task.title}" (due ${task.due_date}, 30+ days overdue)`);
                  } else if (dueDate < fourteenDaysAgo) {
                    score -= 3;
                    console.log(`      📉 Staleness penalty for "${task.title}" (due ${task.due_date})`);
                  }
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

          // Same-day title dedup: keep highest-scored instance only
          const dedupedCandidates = scoredCandidates.filter(task => {
            const normalizedTitle = task.title.toLowerCase().trim();
            if (seenTitlesThisDay.has(normalizedTitle)) return false;
            seenTitlesThisDay.add(normalizedTitle);
            return true;
          });

          const selectedCandidates: typeof scoredCandidates = [];
          const windowRemaining = { ...Object.fromEntries(
            Object.entries(windowCapacities).map(([name, cap]) => [name, cap.remainingMinutes])
          )};

          // Per-day step trace for placement decisions
          const placementStart = Date.now();
          const dayPlacements: Array<Record<string, unknown>> = [];
          const dayRejections: Array<Record<string, unknown>> = [];
          const dayKeywordOverrides: Array<Record<string, unknown>> = [];

          for (const task of dedupedCandidates) {
            const duration = task.estimate_minutes ||
              categoryMappings[task.category]?.estimatedDuration || 60;

            // KEYWORD OVERRIDE: contextRules.keywords beats category default.
            // e.g. "Go to the mall" → matches "shopping" → after_work,
            // even if LIFE category would otherwise allow flexible (9-22).
            const keywordOverride = getKeywordWindowOverride(task.title, contextKeywords, activeWindowNames);
            let preferredWindows: string[];
            if (keywordOverride) {
              preferredWindows = [keywordOverride.window];
              dayKeywordOverrides.push({
                taskId: task.id,
                title: task.title,
                category: task.category,
                matchedKeyword: keywordOverride.matchedKeyword,
                overrideWindow: keywordOverride.window,
              });
              console.log(`      🔑 Keyword override: "${task.title}" matched "${keywordOverride.matchedKeyword}" → ${keywordOverride.window}`);
            } else {
              preferredWindows = getPreferredWindows(task.category, categoryMappings, activeWindowNames);
            }

            let assigned = false;
            let assignedWindow: string | null = null;
            for (const winName of preferredWindows) {
              if ((windowRemaining[winName] || 0) >= duration) {
                windowRemaining[winName] -= duration;
                selectedCandidates.push(task);
                assigned = true;
                assignedWindow = winName;
                break;
              }
            }

            // Flexible capacity aggregation: ONLY when there is no keyword override.
            // Keyword overrides are authoritative — don't sneak around them via aggregate fit.
            if (!assigned && !keywordOverride && preferredWindows.length === activeWindowNames.length) {
              const totalRemaining = Object.values(windowRemaining).reduce((s, v) => s + v, 0);
              if (totalRemaining >= duration) {
                const bestWindow = Object.entries(windowRemaining)
                  .sort(([,a], [,b]) => b - a)[0];
                if (bestWindow) {
                  windowRemaining[bestWindow[0]] -= duration;
                  selectedCandidates.push(task);
                  assigned = true;
                  assignedWindow = bestWindow[0];
                  console.log(`    ✅ "${task.title}" assigned via aggregate capacity to ${bestWindow[0]}`);
                }
              }
            }

            if (assigned) {
              dayPlacements.push({
                taskId: task.id,
                title: task.title,
                category: task.category,
                score: task.score,
                duration,
                window: assignedWindow,
                keywordOverride: keywordOverride?.matchedKeyword ?? null,
              });
            } else {
              dayRejections.push({
                taskId: task.id,
                title: task.title,
                category: task.category,
                score: task.score,
                duration,
                preferredWindows,
                reason: 'no_window_capacity',
                keywordOverride: keywordOverride?.matchedKeyword ?? null,
              });
              console.log(`    ⚠️ "${task.title}" doesn't fit any allowed window — skipping`);
            }

            const totalRemaining = Object.values(windowRemaining).reduce((s, v) => s + v, 0);
            if (totalRemaining <= 0) break;
          }

          pushStep(
            `PLACEMENT_${targetISO}`,
            {
              targetISO,
              dayOfWeek: targetDayOfWeek,
              isWeekend,
              activeWindows: activeWindowNames,
              windowCapacities: Object.fromEntries(
                Object.entries(windowCapacities).map(([n, c]) => [n, { total: c.totalMinutes, remaining: c.remainingMinutes }])
              ),
              candidateCount: dedupedCandidates.length,
            },
            {
              accepted: dayPlacements,
              rejected: dayRejections,
              keywordOverrides: dayKeywordOverrides,
              windowRemainingAfter: windowRemaining,
            },
            placementStart
          );

          console.log(`    🎯 ${selectedCandidates.length} candidates selected for ${targetISO}`);
          selectedCandidates.forEach((t, i) => {
            console.log(`      ${i + 1}. "${t.title}" (score: ${t.score}, est: ${t.estimate_minutes || 60}m, board: ${t.isPriorityBoard})`);
          });

          if (selectedCandidates.length === 0) {
            weekResults[targetISO] = { scheduled: 0, reason: 'no_fit', rejections: dayRejections.length };
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
