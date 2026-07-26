import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DEFAULT_TIME_WINDOWS,
  DEFAULT_CATEGORY_MAPPINGS,
  resolveConfig,
  validateTaskWindow,
  resolveWindowPlan,
  resolvePriorityWeight,
  classifyTaskTraits,
  classifyTaskTraitsLLM,
  mergeTraits,
  type TaskTraits,
  MAX_ASSIGNMENTS_PER_DAY,
  ASSIGNMENT_URGENT_HOURS,
  ASSIGNMENT_PRIORITY_DAYS,
} from "../_shared/scheduling-defaults.ts";
import { getTodayInTimezone, localDateToUtcBounds } from "../_shared/timezone.ts";

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
// getKeywordWindowOverride now lives in _shared/scheduling-defaults.ts so the
// voice/manual smart scheduler honors the same keyword rules as this nightly builder.

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
          // TIMEZONE-SAFE: use shared localDateToUtcBounds helper. NEVER use Date.UTC for local-day bounds.
          const todayBounds = localDateToUtcBounds(todayISO, timezone);
          const todayStartIso = todayBounds.start;
          const todayEndIso = todayBounds.end;

          const { data: todayTasks, error: todayError } = await supabase
            .from('tasks')
            .select('id, title, start_time, external_event_id')
            .eq('user_id', userId)
            .eq('is_scheduled', true)
            .not('status', 'eq', 'DONE')
            .gte('start_time', todayStartIso)
            .lt('start_time', todayEndIso);

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

          // Also purge pending notifications for today (timezone-safe bounds)
          try {
            await supabase
              .from('scheduled_notifications')
              .delete()
              .eq('user_id', userId)
              .eq('status', 'pending')
              .gte('send_at', todayStartIso)
              .lt('send_at', todayEndIso);
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
        // TIMEZONE-SAFE: use timezone-aware date string, never toISOString().split('T')[0]
        // ==========================================
        const thirtyDaysAgo = getTodayInTimezone(timezone).split('-').map(Number);
        const _staleAnchor = new Date(Date.UTC(thirtyDaysAgo[0], thirtyDaysAgo[1] - 1, thirtyDaysAgo[2] - 30));
        const thirtyDaysAgoStr = `${_staleAnchor.getUTCFullYear()}-${String(_staleAnchor.getUTCMonth() + 1).padStart(2, '0')}-${String(_staleAnchor.getUTCDate()).padStart(2, '0')}`;
        
        const { data: staleTasks, error: staleError } = await supabase
          .from('tasks')
          .select('id, title, pushed_count, due_date, category, is_priority, priority')
          .eq('user_id', userId)
          .not('status', 'eq', 'DONE')
          .is('completed_at', null)
          .gte('pushed_count', 5)
          .lt('due_date', thirtyDaysAgoStr);

        let archivedStaleCount = 0;
        if (!staleError && staleTasks && staleTasks.length > 0) {
          for (const stale of staleTasks) {
            // Never auto-complete important work — old ≠ unimportant. Priority-lane and
            // HIGH/URGENT tasks stay visible (they surface in the overdue/priority views)
            // instead of being silently archived to DONE and lost.
            if ((stale as any).is_priority === true || stale.priority === 'HIGH' || stale.priority === 'URGENT') {
              console.log(`  🛡️ Kept important stale task (not archived): "${stale.title}" (pushed ×${stale.pushed_count}, due ${stale.due_date}, priority ${stale.priority}${(stale as any).is_priority ? ', on priority lane' : ''})`);
              continue;
            }
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
        // ASSIGNMENT TIER CLASSIFICATION (cross-horizon)
        // Split assignment-linked candidates into Tier A (≤48h, deadline-critical),
        // Tier B (3-7d or overdue ≤7d, due ASC), Tier C (>7d or overdue >7d, due DESC).
        // ==========================================
        const { data: allAssignmentTasks } = await supabase
          .from('tasks')
          .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status, assignment_id, is_priority, priority_rank, created_at')
          .eq('user_id', userId)
          .not('assignment_id', 'is', null)
          .not('status', 'in', '("DONE","BLOCKED")')
          .is('completed_at', null)
          .is('is_scheduled', false);

        const urgentMs = ASSIGNMENT_URGENT_HOURS * 60 * 60 * 1000;
        const priorityMs = ASSIGNMENT_PRIORITY_DAYS * 24 * 60 * 60 * 1000;
        const nowMs = now.getTime();
        const tierA: any[] = [];
        const tierB: any[] = [];
        const tierC: any[] = [];
        const assignmentTier: Record<string, 'A' | 'B' | 'C'> = {};

        for (const t of (allAssignmentTasks || [])) {
          if (!t.due_date) continue;
          const dueMs = new Date(t.due_date).getTime();
          const delta = dueMs - nowMs;
          if (delta <= urgentMs && delta >= -urgentMs) {
            tierA.push(t); assignmentTier[t.id] = 'A';
          } else if ((delta > urgentMs && delta <= priorityMs) || (delta < -urgentMs && delta >= -priorityMs)) {
            tierB.push(t); assignmentTier[t.id] = 'B';
          } else {
            tierC.push(t); assignmentTier[t.id] = 'C';
          }
        }
        tierA.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
        tierB.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
        tierC.sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime()); // DESC: recent first

        console.log(`  📊 Assignment tiers: A=${tierA.length} (≤48h), B=${tierB.length} (3-7d ±overdue), C=${tierC.length} (>7d ±ancient)`);

        // ==========================================
        // WEEK LOOP: Fill today through Sunday
        // ==========================================
        const scheduledTaskIds = new Set<string>();
        const scheduledTitles = new Set<string>();
        const accumulatedBusySlots: Array<{ start_time: string; end_time: string }> = [];
        const dailyAssignmentCount: Record<string, number> = {}; // targetISO → assignment count placed
        const tierAResults = { categoryPlaced: 0, flexiblePlaced: 0, deferred: 0 };

        // Rolling 7-day horizon (or 1 day in single-day mode)
        const totalDays = singleDay ? 1 : 7;

        // ==========================================
        // PASS 1A: TIER A PRE-PLACEMENT (mini-horizon distribution)
        // For each Tier A item: try category windows first across days from today→due_date,
        // then flexible-window override for any unplaced. Cap-bypassed (deadline-critical).
        // ==========================================
        const { localDateToUtcBounds: _ldub } = await import('../_shared/timezone.ts');

        async function placeTierAItem(task: any): Promise<'category' | 'flexible' | 'deferred'> {
          const dueMs = new Date(task.due_date).getTime();
          const horizonDays = Math.max(1, Math.min(totalDays, Math.ceil((dueMs - nowMs) / 86400000) + 1));
          const duration = task.estimate_minutes || categoryMappings[task.category]?.estimatedDuration || 60;

          // Step 1: try category windows across mini-horizon
          for (let dOff = 0; dOff < horizonDays; dOff++) {
            const [yy, mm, dd] = todayISO.split('-').map(Number);
            const dt = new Date(yy, mm - 1, dd + dOff);
            const isoDay = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            const dow = dt.getDay();
            const active = getActiveWindows(timeWindows, dow);
            const activeNames = Object.keys(active);
            if (activeNames.length === 0) continue;

            const bounds = _ldub(isoDay, timezone);
            const { data: dayScheduled } = await supabase
              .from('tasks').select('start_time, end_time, estimate_minutes')
              .eq('user_id', userId).eq('is_scheduled', true)
              .gte('start_time', bounds.start).lt('start_time', bounds.end);
            const { data: dayEvents } = await supabase
              .from('external_calendar_events').select('start_time, end_time')
              .eq('user_id', userId).gte('start_time', bounds.start).lt('start_time', bounds.end)
              .eq('is_all_day', false);
            const accumulated = accumulatedBusySlots.filter(s => s.start_time >= bounds.start && s.start_time < bounds.end);
            const items = [
              ...(dayScheduled || []),
              ...(dayEvents || []).map(e => ({ ...e, estimate_minutes: undefined })),
              ...accumulated.map(s => ({ ...s, estimate_minutes: undefined })),
            ];
            const caps = computeUsedMinutes(items, active, isoDay, timezone);
            const preferred = getPreferredWindows(task.category, categoryMappings, activeNames);

            for (const winName of preferred) {
              if ((caps[winName]?.remainingMinutes || 0) >= duration) {
                const placed = await callTierAScheduler(task, isoDay, caps, active, false);
                if (placed) {
                  console.log(`    🅰️ [Tier A category] "${task.title}" → ${isoDay} (${winName})`);
                  return 'category';
                }
              }
            }
          }

          // Step 2: flexible-window override across mini-horizon
          const flexWindow = timeWindows['flexible'];
          if (flexWindow) {
            for (let dOff = 0; dOff < horizonDays; dOff++) {
              const [yy, mm, dd] = todayISO.split('-').map(Number);
              const dt = new Date(yy, mm - 1, dd + dOff);
              const isoDay = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
              const dow = dt.getDay();
              if (!flexWindow.days?.includes(dow)) continue;

              const bounds = _ldub(isoDay, timezone);
              const { data: dayScheduled } = await supabase
                .from('tasks').select('start_time, end_time, estimate_minutes')
                .eq('user_id', userId).eq('is_scheduled', true)
                .gte('start_time', bounds.start).lt('start_time', bounds.end);
              const { data: dayEvents } = await supabase
                .from('external_calendar_events').select('start_time, end_time')
                .eq('user_id', userId).gte('start_time', bounds.start).lt('start_time', bounds.end)
                .eq('is_all_day', false);
              const accumulated = accumulatedBusySlots.filter(s => s.start_time >= bounds.start && s.start_time < bounds.end);
              const flexActive = {
                flexible: { start: flexWindow.start, end: flexWindow.end, totalMinutes: (flexWindow.end - flexWindow.start) * 60 }
              };
              const items = [
                ...(dayScheduled || []),
                ...(dayEvents || []).map(e => ({ ...e, estimate_minutes: undefined })),
                ...accumulated.map(s => ({ ...s, estimate_minutes: undefined })),
              ];
              const caps = computeUsedMinutes(items, flexActive, isoDay, timezone);
              if ((caps.flexible?.remainingMinutes || 0) >= duration) {
                const placed = await callTierAScheduler(task, isoDay, caps, flexActive, true);
                if (placed) {
                  console.log(`    🅰️ [Tier A flexible-overflow] "${task.title}" → ${isoDay}`);
                  return 'flexible';
                }
              }
            }
          }

          console.log(`    ⚠️ [Tier A deferred] "${task.title}" — no slot before due ${task.due_date}`);
          return 'deferred';
        }

        async function callTierAScheduler(
          task: any,
          targetISO: string,
          caps: Record<string, WindowCapacity>,
          active: Record<string, { start: number; end: number; totalMinutes: number }>,
          flexibleOverride: boolean
        ): Promise<boolean> {
          const payload = {
            tasks: [{
              id: task.id,
              title: task.title,
              // When flexible override, send LIFE so batch-scheduler treats as flexible category
              category: flexibleOverride ? 'LIFE' : task.category,
              priority: task.priority,
              estimate_minutes: task.estimate_minutes || categoryMappings[task.category]?.estimatedDuration || 60,
              due_date: task.due_date,
            }],
            userId,
            timezone,
            targetDate: targetISO,
            allowOverflow: false,
            windowCapacity: Object.fromEntries(
              Object.entries(caps).map(([n, c]) => [
                n, { totalMinutes: c.totalMinutes, remainingMinutes: c.remainingMinutes, start: active[n].start, end: active[n].end }
              ])
            ),
          };
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/batch-calendar-scheduler`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify(payload),
            });
            if (!resp.ok) return false;
            const result = await resp.json();
            const slot = (result.scheduled || [])[0];
            if (!slot?.start_time || !slot?.end_time || !slot?.taskId) return false;
            const { error } = await supabase.from('tasks').update({
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_scheduled: true,
              scheduling_context: { pre_schedule_status: task.status || 'TODO', assignment_tier: 'A' },
              status: 'TODO',
              updated_at: now.toISOString(),
            }).eq('id', slot.taskId);
            if (error) return false;
            scheduledTaskIds.add(slot.taskId);
            scheduledTitles.add(task.title);
            accumulatedBusySlots.push({ start_time: slot.start_time, end_time: slot.end_time });
            dailyAssignmentCount[targetISO] = (dailyAssignmentCount[targetISO] || 0) + 1;
            return true;
          } catch (err) {
            console.warn(`    ⚠️ Tier A scheduler call failed:`, err);
            return false;
          }
        }

        for (const tA of tierA) {
          const outcome = await placeTierAItem(tA);
          if (outcome === 'category') tierAResults.categoryPlaced++;
          else if (outcome === 'flexible') tierAResults.flexiblePlaced++;
          else tierAResults.deferred++;
        }
        if (tierA.length > 0) {
          console.log(`  🅰️ Tier A summary: ${tierAResults.categoryPlaced} category + ${tierAResults.flexiblePlaced} flexible-overflow + ${tierAResults.deferred} deferred`);
        }

        let totalScheduledAcrossWeek = 0;
        const weekResults: Record<string, any> = {};

        // ── Warm the trait cache ONCE for the whole run ──────────────────────────
        // Trait classification depends only on the title, so we compute it a single
        // time per unique title (bounded concurrency) BEFORE the per-day loop rather
        // than calling the LLM inside the nested day×task placement loops. The LLM
        // pass GENERALIZES beyond the deterministic anchors (optometrist, DMV, vet…)
        // so the keyword fallback is rarely reached; it returns null on any failure so
        // the deterministic anchor floor is never lost. Keyed by normalized title.
        const traitsByTitle = new Map<string, TaskTraits>();
        try {
          const { data: warmTasks } = await supabase
            .from('tasks')
            .select('title')
            .eq('user_id', userId)
            .in('status', ['READY', 'UP_NEXT', 'TODO', 'BACKLOG'])
            .is('is_scheduled', false)
            .is('completed_at', null)
            .not('title', 'ilike', '%Test Task%');
          const uniqueTitles = [...new Set((warmTasks || [])
            .map((t: any) => (t.title || '').trim())
            .filter((t: string) => t.length > 0))];
          const lovableKey = Deno.env.get('LOVABLE_API_KEY');
          let llmHits = 0, llmGeneralized = 0;
          const CONCURRENCY = 5;
          for (let i = 0; i < uniqueTitles.length; i += CONCURRENCY) {
            const batch = uniqueTitles.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (title) => {
              const anchor = classifyTaskTraits(title);
              const llm = lovableKey ? await classifyTaskTraitsLLM(title, lovableKey) : null;
              if (llm) {
                llmHits++;
                if (llm.venueDependent !== anchor.venueDependent || llm.appointment !== anchor.appointment) llmGeneralized++;
              }
              traitsByTitle.set(title.toLowerCase(), mergeTraits(anchor, llm));
            }));
          }
          console.log(`  🤖 Trait warm-up: ${uniqueTitles.length} titles, ${llmHits} LLM-classified, ${llmGeneralized} generalized beyond anchors${lovableKey ? '' : ' (no LOVABLE_API_KEY — deterministic anchors only)'}`);
        } catch (warmErr) {
          console.warn(`  ⚠️ Trait warm-up failed (falling back to per-task deterministic anchors):`, warmErr);
        }

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
          // Priority weights come from the user's GUI config (contextRules.priorityMappings)
          // instead of a hardcoded map — falls back to 4/3/2/1 when unset.
          const priorityWeight: Record<string, number> = resolvePriorityWeight(config);
          
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
              
              // Pushed-count: soft signal only — never bury a task because the system
              // failed to schedule it. is_priority items skip even the mild -1 hint.
              if (task.pushed_count && task.pushed_count > 0) {
                const n = task.pushed_count;
                if (n <= 3) score += 1;
                else if (n <= 7) { /* neutral */ }
                else if (!(task as any).is_priority) score -= 1;
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
                // Don't bury important-but-old work with the staleness penalty — that penalty is
                // what keeps it from ever winning a slot, so it rolls over until it trips the stale
                // auto-archive. Keep priority-lane and HIGH/URGENT tasks competitive instead.
                const isImportant = (task as any).is_priority === true || task.priority === 'HIGH' || task.priority === 'URGENT';
                if (!isAssignmentInGrace && !isImportant) {
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

          // Sort: Tier A → Tier B → everything else (Tier C + non-assignment) competes on
          // is_priority → priority_rank → score → due_date NULLS LAST.
          // Per approved plan: Tier A/B keep deadline-jump behavior (immovable external dates);
          // Tier C no longer auto-jumps priority-board work.
          scoredCandidates.sort((a, b) => {
            const aTier = (a as any).assignment_id ? (assignmentTier[a.id] || 'C') : null;
            const bTier = (b as any).assignment_id ? (assignmentTier[b.id] || 'C') : null;

            // Tier A always first
            const aIsAB = aTier === 'A' || aTier === 'B';
            const bIsAB = bTier === 'A' || bTier === 'B';
            if (aIsAB && !bIsAB) return -1;
            if (!aIsAB && bIsAB) return 1;

            // Both are A/B — A before B, then due ASC within each tier
            if (aIsAB && bIsAB) {
              if (aTier !== bTier) return aTier === 'A' ? -1 : 1;
              const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
              const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
              return aDue - bDue;
            }

            // Everyone else (Tier C + non-assignment) competes on the same comparator
            const aPri = (a as any).is_priority ? 1 : 0;
            const bPri = (b as any).is_priority ? 1 : 0;
            if (aPri !== bPri) return bPri - aPri;
            if (aPri && bPri) {
              const aRank = (a as any).priority_rank ?? 9999;
              const bRank = (b as any).priority_rank ?? 9999;
              if (aRank !== bRank) return aRank - bRank;
            }
            if (b.score !== a.score) return b.score - a.score;
            // due_date ASC NULLS LAST
            if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            if (a.due_date) return -1;
            if (b.due_date) return 1;
            return 0;
          });

          // SCORING_AUDIT: emit top-20 score breakdown for diagnostic queries.
          // Lets us answer "why did X outscore Y" without re-running the builder.
          const auditTop = scoredCandidates.slice(0, 20).map((t: any) => ({
            taskId: t.id,
            title: t.title,
            score: t.score,
            assignment_tier: (t as any).assignment_id ? (assignmentTier[t.id] || 'C') : null,
            is_priority: !!(t as any).is_priority,
            priority_rank: (t as any).priority_rank ?? null,
            pushed_count: (t as any).pushed_count ?? 0,
            due_date: t.due_date ?? null,
          }));
          pushStep(
            `SCORING_AUDIT_${targetISO}`,
            { targetISO, candidateCount: scoredCandidates.length },
            { topTwenty: auditTop },
            Date.now(),
          );

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
          // Venue-dependent tasks placed after-work carry a nudge to move them into
          // business hours (when the venue is likely open). We persist that nudge on the
          // task so the morning review / day context can DELIVER it to the user.
          const venueNudgeByTaskId = new Map<string, { toWindow: string; message: string }>();
          const deferredAssignmentsToday: Array<{ id: string; tier: 'B' | 'C' }> = [];

          for (const task of dedupedCandidates) {
            const duration = task.estimate_minutes ||
              categoryMappings[task.category]?.estimatedDuration || 60;

            const isAssignment = !!(task as any).assignment_id;
            const tier = isAssignment ? (assignmentTier[task.id] || 'C') : null;
            const placedAssignmentsToday = dailyAssignmentCount[targetISO] || 0;

            // Pass 1B/1C cap: Tier B/C assignments are limited to MAX_ASSIGNMENTS_PER_DAY/day.
            // Tier A bypasses the cap (deadline-critical, pre-placed in Pass 1A).
            if (isAssignment && tier !== 'A' && placedAssignmentsToday >= MAX_ASSIGNMENTS_PER_DAY) {
              deferredAssignmentsToday.push({ id: task.id, tier: tier as 'B' | 'C' });
              dayRejections.push({
                taskId: task.id, title: task.title, category: task.category,
                score: task.score, duration,
                reason: `assignment_cap_${MAX_ASSIGNMENTS_PER_DAY}_per_day`,
                tier,
              });
              continue;
            }

            // AGREED precedence: explicit > trait (appointment / venue-dependent) >
            // keyword table (FALLBACK) > category default. Keywords no longer beat a
            // trait — "bank" is venue-dependent → after-work (with a business-hours nudge)
            // rather than the old "bank → business_hours" keyword mapping.
            const cachedTraits = traitsByTitle.get((task.title || '').trim().toLowerCase());
            const plan = resolveWindowPlan(task.title, task.category, config, timeWindows, categoryMappings, { traits: cachedTraits });
            let preferredWindows = plan.allowedWindows.filter((w) => activeWindowNames.includes(w));
            if (preferredWindows.length === 0) {
              preferredWindows = getPreferredWindows(task.category, categoryMappings, activeWindowNames);
            }
            const windowConstrained = plan.source === 'trait' || plan.source === 'keyword' || plan.source === 'explicit';
            if (plan.matchedKeyword) {
              dayKeywordOverrides.push({
                taskId: task.id, title: task.title, category: task.category,
                matchedKeyword: plan.matchedKeyword,
                overrideWindow: preferredWindows[0],
              });
              // LOUD: placement fell to the low-confidence keyword fallback (no trait).
              console.warn(`      ⚠️⚠️ KEYWORD FALLBACK: "${task.title}" matched "${plan.matchedKeyword}" → ${preferredWindows[0]} (no trait — low-confidence placement)`);
            } else if (plan.trait) {
              console.log(`      🧭 Trait ${plan.trait}: "${task.title}" → [${preferredWindows.join(', ')}]${plan.nudgeToBusinessHours ? ' (nudge → business hours)' : ''}`);
            }
            if (plan.nudgeToBusinessHours) {
              venueNudgeByTaskId.set(task.id, {
                toWindow: 'business_hours',
                message: `"${task.title}" is scheduled after work, but this kind of errand usually needs a place that's open during business hours. Want to move it into a business-hours slot?`,
              });
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

            // Flexible capacity aggregation: ONLY for non-assignment tasks without keyword override.
            // Assignments must respect their category windows; aggregate-fit would bypass that.
            if (!assigned && !isAssignment && !windowConstrained && preferredWindows.length === activeWindowNames.length) {
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
              if (isAssignment) {
                dailyAssignmentCount[targetISO] = placedAssignmentsToday + 1;
              }
              dayPlacements.push({
                taskId: task.id, title: task.title, category: task.category,
                score: task.score, duration, window: assignedWindow,
                keywordOverride: plan.matchedKeyword ?? null,
                trait: plan.trait ?? null,
                tier,
              });
            } else {
              if (isAssignment && tier && tier !== 'A') {
                deferredAssignmentsToday.push({ id: task.id, tier: tier as 'B' | 'C' });
              }
              dayRejections.push({
                taskId: task.id, title: task.title, category: task.category,
                score: task.score, duration, preferredWindows,
                reason: 'no_window_capacity',
                keywordOverride: plan.matchedKeyword ?? null,
                trait: plan.trait ?? null,
                tier,
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
          const committedIds = new Set<string>();
          for (const slot of scheduled) {
            if (!slot.taskId || !slot.start_time || !slot.end_time) {
              console.log(`    ⏭️ Skipping task ${slot.taskId || 'unknown'}: no valid time slot`);
              continue;
            }

            const candidate = selectedCandidates.find(c => c.id === slot.taskId);
            const preScheduleStatus = candidate?.status || 'TODO';
            const venueNudge = venueNudgeByTaskId.get(slot.taskId);

            const { error: scheduleError } = await supabase
              .from('tasks')
              .update({
                start_time: slot.start_time,
                end_time: slot.end_time,
                is_scheduled: true,
                scheduling_context: {
                  pre_schedule_status: preScheduleStatus,
                  ...(venueNudge ? { venue_nudge: venueNudge } : {}),
                },
                status: 'TODO',
                updated_at: now.toISOString(),
              })
              .eq('id', slot.taskId);

            if (scheduleError) {
              console.error(`    ❌ Error scheduling task ${slot.taskId}:`, scheduleError);
            } else {
              actuallyScheduled++;
              committedIds.add(slot.taskId);
              scheduledTaskIds.add(slot.taskId);
              scheduledTitles.add(candidate?.title || '');
              accumulatedBusySlots.push({ start_time: slot.start_time, end_time: slot.end_time });
            }
          }

          // ==========================================
          // RESHUFFLE PASS: AI-rejected candidates get one retry in expanded windows
          // ==========================================
          const aiRejected = selectedCandidates.filter(c => !committedIds.has(c.id));
          let reshuffleAttempted = 0;
          let reshuffleCommitted = 0;
          const reshuffleDeferred: Array<Record<string, unknown>> = [];

          if (aiRejected.length > 0) {
            console.log(`    🔁 Reshuffle pass: ${aiRejected.length} AI-rejected candidates → retrying in expanded windows`);

            // Recompute remaining capacity from accumulatedBusySlots for this day
            const dayBounds = _ldub(targetISO, timezone);
            const dayBusyForRetry = accumulatedBusySlots.filter(s => {
              const sMs = new Date(s.start_time).getTime();
              return sMs >= new Date(dayBounds.start).getTime() && sMs < new Date(dayBounds.end).getTime();
            });
            const retryCaps = computeUsedMinutes(
              dayBusyForRetry.map(s => ({ start_time: s.start_time, end_time: s.end_time })),
              activeWindows,
              targetISO,
              timezone,
            );

            // Filter to candidates that still have capacity in ANY active window (not just preferred)
            const retryEligible = aiRejected.filter(t => {
              const duration = t.estimate_minutes || categoryMappings[t.category]?.estimatedDuration || 60;
              return activeWindowNames.some(w => (retryCaps[w]?.remainingMinutes || 0) >= duration);
            });

            for (const t of aiRejected) {
              if (!retryEligible.includes(t)) {
                reshuffleDeferred.push({
                  taskId: t.id, title: t.title, category: t.category,
                  reason: 'no_capacity_any_window',
                });
              }
            }

            if (retryEligible.length > 0) {
              reshuffleAttempted = retryEligible.length;
              const retryPayload = {
                tasks: retryEligible.map(t => ({
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
                allowOverflow: true, // expanded windows on retry
                windowCapacity: Object.fromEntries(
                  Object.entries(retryCaps).map(([name, cap]) => [
                    name,
                    {
                      totalMinutes: cap.totalMinutes,
                      remainingMinutes: cap.remainingMinutes,
                      start: activeWindows[name].start,
                      end: activeWindows[name].end,
                    },
                  ])
                ),
              };

              try {
                const retryResp = await fetch(
                  `${supabaseUrl}/functions/v1/batch-calendar-scheduler`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${supabaseServiceKey}`,
                    },
                    body: JSON.stringify(retryPayload),
                  }
                );

                if (retryResp.ok) {
                  const retryResult = await retryResp.json();
                  const retrySlots = retryResult.scheduled || [];
                  for (const slot of retrySlots) {
                    if (!slot.taskId || !slot.start_time || !slot.end_time) continue;
                    const candidate = retryEligible.find(c => c.id === slot.taskId);
                    const preScheduleStatus = candidate?.status || 'TODO';
                    const retryVenueNudge = venueNudgeByTaskId.get(slot.taskId);
                    const { error: retryErr } = await supabase
                      .from('tasks')
                      .update({
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        is_scheduled: true,
                        scheduling_context: {
                          pre_schedule_status: preScheduleStatus,
                          reshuffle_retry: true,
                          ...(retryVenueNudge ? { venue_nudge: retryVenueNudge } : {}),
                        },
                        status: 'TODO',
                        updated_at: now.toISOString(),
                      })
                      .eq('id', slot.taskId);
                    if (!retryErr) {
                      reshuffleCommitted++;
                      actuallyScheduled++;
                      committedIds.add(slot.taskId);
                      scheduledTaskIds.add(slot.taskId);
                      scheduledTitles.add(candidate?.title || '');
                      accumulatedBusySlots.push({ start_time: slot.start_time, end_time: slot.end_time });
                      console.log(`      🔁 [Reshuffle] "${candidate?.title}" placed in retry window`);
                    }
                  }
                  // Anything still uncommitted = AI couldn't find a slot
                  for (const t of retryEligible) {
                    if (!committedIds.has(t.id)) {
                      reshuffleDeferred.push({
                        taskId: t.id, title: t.title, category: t.category,
                        reason: 'ai_no_slot_after_retry',
                      });
                    }
                  }
                } else {
                  console.warn(`    ⚠️ Reshuffle retry HTTP ${retryResp.status}`);
                  for (const t of retryEligible) {
                    reshuffleDeferred.push({
                      taskId: t.id, title: t.title, category: t.category,
                      reason: `retry_http_${retryResp.status}`,
                    });
                  }
                }
              } catch (retryErr) {
                console.warn(`    ⚠️ Reshuffle retry failed:`, retryErr);
                for (const t of retryEligible) {
                  reshuffleDeferred.push({
                    taskId: t.id, title: t.title, category: t.category,
                    reason: 'retry_exception',
                  });
                }
              }
            }

            pushStep(
              `RESCHEDULE_RETRY_${targetISO}`,
              { targetISO, aiRejectedCount: aiRejected.length, retryEligibleCount: retryEligible.length },
              { attempted: reshuffleAttempted, committed: reshuffleCommitted, deferred: reshuffleDeferred },
              Date.now(),
            );

            if (reshuffleDeferred.length > 0) {
              try {
                await supabase.from('activity_log').insert({
                  user_id: userId,
                  activity_type: 'reschedule_deferred',
                  status: 'completed',
                  metadata: { targetISO, deferred: reshuffleDeferred, runId },
                });
              } catch (_) { /* best effort */ }
            }
          }

          // ==========================================
          // DB-RECONCILED ASSIGNMENT COUNTER
          // The optimistic in-loop increments can drift from reality (AI drops, retries).
          // Reconcile by querying the actual count of assignment-linked tasks placed today.
          // ==========================================
          try {
            const dayBoundsForCount = _ldub(targetISO, timezone);
            const { count: realAssignmentCount } = await supabase
              .from('tasks')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', userId)
              .eq('is_scheduled', true)
              .not('assignment_id', 'is', null)
              .gte('start_time', dayBoundsForCount.start)
              .lt('start_time', dayBoundsForCount.end);
            if (typeof realAssignmentCount === 'number') {
              const before = dailyAssignmentCount[targetISO] || 0;
              dailyAssignmentCount[targetISO] = realAssignmentCount;
              if (before !== realAssignmentCount) {
                console.log(`    🔢 Reconciled assignment count for ${targetISO}: ${before} → ${realAssignmentCount}`);
              }
            }
          } catch (e) {
            console.warn(`    ⚠️ Assignment count reconciliation failed:`, e);
          }

          totalScheduledAcrossWeek += actuallyScheduled;
          weekResults[targetISO] = { scheduled: actuallyScheduled, candidates: selectedCandidates.length };
          console.log(`    ✅ Actually scheduled ${actuallyScheduled}/${scheduled.length} tasks for ${targetISO}`);
        }

        // ==========================================
        // PASS 3: TOP-UP — fill remaining slots with deferred Tier B/C assignments
        // For each day where assignment count < cap, walk deferred items in tier-sort
        // order (B before C; B due-asc; C due-desc). Honor category windows.
        // ==========================================
        const tierBPending = tierB.filter(t => !scheduledTaskIds.has(t.id));
        const tierCPending = tierC.filter(t => !scheduledTaskIds.has(t.id));
        const topUpQueue = [...tierBPending, ...tierCPending]; // already sorted within each tier
        let topUpPlaced = 0;

        if (topUpQueue.length > 0) {
          for (let dOff = 0; dOff < totalDays && topUpQueue.length > 0; dOff++) {
            const [tY, tM, tD] = todayISO.split('-').map(Number);
            const dt = new Date(tY, tM - 1, tD + dOff);
            const isoDay = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            if ((dailyAssignmentCount[isoDay] || 0) >= MAX_ASSIGNMENTS_PER_DAY) continue;

            const dow = dt.getDay();
            const active = getActiveWindows(timeWindows, dow);
            const activeNames = Object.keys(active);
            if (activeNames.length === 0) continue;

            const bounds = _ldub(isoDay, timezone);
            const { data: dayScheduled2 } = await supabase
              .from('tasks').select('start_time, end_time, estimate_minutes')
              .eq('user_id', userId).eq('is_scheduled', true)
              .gte('start_time', bounds.start).lt('start_time', bounds.end);
            const { data: dayEvents2 } = await supabase
              .from('external_calendar_events').select('start_time, end_time')
              .eq('user_id', userId).gte('start_time', bounds.start).lt('start_time', bounds.end)
              .eq('is_all_day', false);
            const items = [
              ...(dayScheduled2 || []),
              ...(dayEvents2 || []).map(e => ({ ...e, estimate_minutes: undefined })),
            ];
            let caps = computeUsedMinutes(items, active, isoDay, timezone);

            for (let i = 0; i < topUpQueue.length; i++) {
              if ((dailyAssignmentCount[isoDay] || 0) >= MAX_ASSIGNMENTS_PER_DAY) break;
              const task = topUpQueue[i];
              const duration = task.estimate_minutes || categoryMappings[task.category]?.estimatedDuration || 60;
              const preferred = getPreferredWindows(task.category, categoryMappings, activeNames);
              const fits = preferred.some(w => (caps[w]?.remainingMinutes || 0) >= duration);
              if (!fits) continue;
              const placed = await callTierAScheduler(task, isoDay, caps, active, false);
              if (placed) {
                topUpPlaced++;
                topUpQueue.splice(i, 1);
                i--;
                // Recompute caps cheaply by subtracting duration from a fitting window
                for (const w of preferred) {
                  if ((caps[w]?.remainingMinutes || 0) >= duration) {
                    caps[w].remainingMinutes -= duration;
                    caps[w].usedMinutes += duration;
                    break;
                  }
                }
                console.log(`    🔁 [Pass 3 top-up] "${task.title}" (Tier ${assignmentTier[task.id]}) → ${isoDay}`);
              }
            }
          }
          totalScheduledAcrossWeek += topUpPlaced;
          if (topUpPlaced > 0) console.log(`  🔁 Pass 3 top-up placed ${topUpPlaced} deferred assignments`);
        }

        // ==========================================
        // STEP 6: Log the run
        // ==========================================
        // Aggregate reshuffle outcomes across all days
        const reshuffleSteps = steps.filter(s => s.step.startsWith('RESCHEDULE_RETRY_'));
        const reshuffleTotals = reshuffleSteps.reduce(
          (acc, s) => {
            const out = s.outputs as any;
            acc.attempted += out?.attempted ?? 0;
            acc.committed += out?.committed ?? 0;
            acc.deferred += Array.isArray(out?.deferred) ? out.deferred.length : 0;
            return acc;
          },
          { attempted: 0, committed: 0, deferred: 0 },
        );

        // Calendar status snapshot for today (used by daily-review pipeline messaging)
        // Tri-state: connected_with_events | connected_no_events | not_connected | query_failed
        // NOTE: get_calendar_connections_safe RPC requires auth.uid() context (memory:
        // service-role-rpc-constraint), so the builder uses a direct query that mirrors
        // the same filters (is_active=true, scoped to user_id).
        let calendarStatus: Record<string, unknown> = { state: 'query_failed', events_today: 0, connection_count: 0, sources: [] };
        try {
          const todayBounds = localDateToUtcBounds(todayISO, timezone);
          const [eventsRes, connRes] = await Promise.all([
            supabase
              .from('external_calendar_events')
              .select('id, connection_id')
              .eq('user_id', userId)
              .gte('start_time', todayBounds.start)
              .lt('start_time', todayBounds.end)
              .eq('is_all_day', false),
            supabase
              .from('calendar_connections')
              .select('provider, is_active')
              .eq('user_id', userId)
              .eq('is_active', true),
          ]);
          if (connRes.error) {
            console.warn('  ⚠️ calendar_connections query failed:', connRes.error.message);
            calendarStatus = { state: 'query_failed', events_today: 0, connection_count: 0, sources: [], error: connRes.error.message };
          } else {
            const connectionCount = connRes.data?.length ?? 0;
            const eventsToday = eventsRes.data?.length ?? 0;
            const sources = Array.from(new Set((connRes.data || []).map((c: any) => c.provider)));
            let state: 'connected_with_events' | 'connected_no_events' | 'not_connected';
            if (connectionCount === 0) state = 'not_connected';
            else if (eventsToday === 0) state = 'connected_no_events';
            else state = 'connected_with_events';
            calendarStatus = {
              state,
              events_today: eventsToday,
              connection_count: connectionCount,
              sources,
            };
          }
        } catch (e: any) {
          console.warn('  ⚠️ Calendar status snapshot failed:', e?.message ?? e);
          calendarStatus = { state: 'query_failed', events_today: 0, connection_count: 0, sources: [], error: String(e?.message ?? e) };
        }

        await supabase.from('activity_log').insert({
          user_id: userId,
          activity_type: 'nightly_schedule_built',
          status: 'completed',
          metadata: {
            runId,
            triggerSource,
            singleDay,
            rolled_over: rolledOverCount,
            archived_stale: archivedStaleCount,
            total_scheduled: totalScheduledAcrossWeek,
            days_processed: totalDays,
            week_results: weekResults,
            steps,
            assignment_tiers: {
              tierA_count: tierA.length,
              tierB_count: tierB.length,
              tierC_count: tierC.length,
              tierA_category_placed: tierAResults.categoryPlaced,
              tierA_flexible_overflow_placed: tierAResults.flexiblePlaced,
              tierA_deferred: tierAResults.deferred,
              top_up_placed: topUpPlaced,
              daily_assignment_count: dailyAssignmentCount,
            },
            reshuffle: reshuffleTotals,
            calendar_status: calendarStatus,
            keyword_overrides_total: steps.reduce(
              (sum, s) => sum + (Array.isArray((s.outputs as any)?.keywordOverrides) ? (s.outputs as any).keywordOverrides.length : 0),
              0
            ),
            rejections_total: steps.reduce(
              (sum, s) => sum + (Array.isArray((s.outputs as any)?.rejected) ? (s.outputs as any).rejected.length : 0),
              0
            ),
            processing_ms: Date.now() - startTime,
          },
        });

        results[userId] = {
          runId,
          triggerSource,
          rolledOver: rolledOverCount,
          archivedStale: archivedStaleCount,
          totalScheduled: totalScheduledAcrossWeek,
          daysProcessed: totalDays,
          weekResults,
          assignmentTiers: {
            tierA: tierA.length,
            tierB: tierB.length,
            tierC: tierC.length,
            tierAResults,
            topUpPlaced,
            dailyAssignmentCount,
          },
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
