import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Task {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  start_time?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  status: string;
  user_id: string;
}

interface NotificationPrefs {
  user_id: string;
  due_reminders_enabled: boolean;
  overdue_reminders_enabled: boolean;
  daily_digest_enabled: boolean;
  weekly_digest_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  channels: string[];
  calendar_reminders_enabled: boolean;
  calendar_reminder_minutes: number;
  calendar_reminder_channels: string[];
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = req.method === 'POST' ? await req.json() : {};
    const { immediate = false } = requestBody;
    
    console.log('Starting notification scheduler...', { immediate });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    const notifications: any[] = [];

    // Get all users with notification preferences
    const { data: allPrefs, error: prefsError } = await supabaseClient
      .from('notification_prefs')
      .select('*');

    if (prefsError) {
      console.error('Error fetching notification preferences:', prefsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch preferences' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Processing notifications for ${allPrefs?.length || 0} users`);

    for (const prefs of allPrefs || []) {
      try {
        const userNotifications = await processUserNotifications(supabaseClient, prefs, now);
        notifications.push(...userNotifications);
      } catch (error) {
        console.error(`Error processing notifications for user ${prefs.user_id}:`, error);
        continue;
      }
    }

    // Schedule all notifications
    if (notifications.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('scheduled_notifications')
        .insert(notifications);

      if (insertError) {
        console.error('Error scheduling notifications:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to schedule notifications' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    console.log(`Scheduled ${notifications.length} notifications`);


    return new Response(
      JSON.stringify({ 
        success: true, 
        scheduled: notifications.length,
        timestamp: now.toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in notification scheduler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function processUserNotifications(
  supabaseClient: any, 
  prefs: NotificationPrefs, 
  now: Date
): Promise<any[]> {
  const notifications: any[] = [];
  
  // Check if we're in quiet hours - still generate future reminders but skip immediate digests
  const inQuietHours = isInQuietHours(now, prefs);
  if (inQuietHours) {
    console.log(`User ${prefs.user_id} is in quiet hours, generating future reminders but skipping immediate digests`);
  }

  // TIMEZONE FIX: all "fire at Nam" trigger checks below must use the USER's local clock, not the
  // Deno server's UTC clock. Previously `now.getHours()===8/9` fired the digest at 4am and overdue
  // reminders at 5am ET (8/9 UTC). `userNow` carries the user-timezone wall-clock for those checks.
  const userTz = prefs.timezone || 'UTC';
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: userTz }));

  // Get user's tasks
  const { data: tasks, error: tasksError } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', prefs.user_id)
    .neq('status', 'DONE');

  if (tasksError) {
    console.error('Error fetching tasks:', tasksError);
    return notifications;
  }

  // NOTE: Due date and start time reminders are now handled by the database trigger
  // on the tasks table (schedule_task_reminders function) to prevent duplicates

  // Process overdue reminders — gated by quiet hours (previously fired at 5am ET, un-gated) and
  // triggered on the USER's 9am, not the server's 9am-UTC.
  if (!inQuietHours && prefs.overdue_reminders_enabled) {
    const overdueReminders = generateOverdueReminders(tasks || [], prefs.user_id, now, userNow);
    notifications.push(...overdueReminders);
  }

  // Process daily digest (check if it's the right time) - only if not in quiet hours
  if (!inQuietHours && prefs.daily_digest_enabled && shouldSendDailyDigest(userNow)) {
    const dailyDigest = generateDailyDigest(tasks || [], prefs.user_id, now);
    if (dailyDigest) notifications.push(dailyDigest);
  }

  // Process weekly digest (check if it's the right time) - only if not in quiet hours
  if (!inQuietHours && prefs.weekly_digest_enabled && shouldSendWeeklyDigest(userNow)) {
    const weeklyDigest = generateWeeklyDigest(tasks || [], prefs.user_id, now);
    if (weeklyDigest) notifications.push(weeklyDigest);
  }

  // Process external calendar event reminders
  if (prefs.calendar_reminders_enabled) {
    const calendarReminders = await generateCalendarEventReminders(
      supabaseClient, prefs, now, inQuietHours
    );
    notifications.push(...calendarReminders);
  }

  return notifications;
}

function isInQuietHours(now: Date, prefs: NotificationPrefs): boolean {
  const userTz = prefs.timezone || 'UTC';
  const userTime = new Date(now.toLocaleString("en-US", {timeZone: userTz}));
  
  const quietStart = prefs.quiet_hours_start;
  const quietEnd = prefs.quiet_hours_end;
  
  if (!quietStart || !quietEnd) return false;
  
  const currentHour = userTime.getHours();
  const currentMinute = userTime.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  const [startHour, startMinute] = quietStart.split(':').map(Number);
  const [endHour, endMinute] = quietEnd.split(':').map(Number);
  
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;
  
  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  } else {
    return currentTime >= startTime && currentTime < endTime;
  }
}

function getQuietHoursEnd(now: Date, preferences: NotificationPrefs): Date {
  const userTz = preferences.timezone || 'UTC';
  const quietEnd = preferences.quiet_hours_end;
  
  if (!quietEnd) return now;
  
  const [endHour, endMinute] = quietEnd.split(':').map(Number);
  const userTime = new Date(now.toLocaleString("en-US", {timeZone: userTz}));
  
  const endTime = new Date(userTime);
  endTime.setHours(endHour, endMinute, 0, 0);
  
  // If end time is before current time, it's tomorrow
  if (endTime <= userTime) {
    endTime.setDate(endTime.getDate() + 1);
  }
  
  return endTime;
}

function generateDueReminders(tasks: Task[], userId: string, now: Date, preferences?: NotificationPrefs): any[] {
  const notifications: any[] = [];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  for (const task of tasks) {
    if (!task.due_date) continue;

    const dueDate = new Date(task.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Remind 1 day before due date
    if (dueDate.getTime() === tomorrow.getTime()) {
      let scheduledFor = new Date(now.getTime() + 8 * 60 * 60 * 1000); // Default 8 AM tomorrow
      let queuedDuringQuiet = false;
      let originalScheduledFor = null;
      
      if (preferences && isInQuietHours(scheduledFor, preferences)) {
        originalScheduledFor = scheduledFor.toISOString();
        scheduledFor = getQuietHoursEnd(scheduledFor, preferences);
        queuedDuringQuiet = true;
      }
      
      notifications.push({
        user_id: userId,
        task_id: task.id,
        notification_type: 'due_reminder',
        title: 'Task Due Tomorrow',
        body: `"${task.title}" is due tomorrow`,
        scheduled_for: scheduledFor.toISOString(),
        queued_during_quiet: queuedDuringQuiet,
        original_scheduled_for: originalScheduledFor
      });
    }

    // Remind on due date (morning)
    if (dueDate.getTime() === now.getTime() && now.getHours() === 9) {
      notifications.push({
        user_id: userId,
        task_id: task.id,
        notification_type: 'due_today',
        title: 'Task Due Today',
        body: `"${task.title}" is due today`,
        scheduled_for: now.toISOString()
      });
    }
  }

  return notifications;
}

function generateStartTimeReminders(tasks: Task[], userId: string, now: Date): any[] {
  const notifications: any[] = [];
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  for (const task of tasks) {
    if (!task.start_time) continue;

    const startTime = new Date(task.start_time);
    
    // Remind 15 minutes before start time
    if (startTime <= oneHourFromNow && startTime > fifteenMinutesFromNow) {
      notifications.push({
        user_id: userId,
        task_id: task.id,
        notification_type: 'start_time_reminder',
        title: 'Task Starting Soon',
        body: `"${task.title}" starts in 15 minutes`,
        scheduled_for: new Date(startTime.getTime() - 15 * 60 * 1000).toISOString()
      });
    }
  }

  return notifications;
}

function generateOverdueReminders(tasks: Task[], userId: string, now: Date, userNow: Date = now): any[] {
  const notifications: any[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const task of tasks) {
    if (!task.due_date) continue;

    const dueDate = new Date(task.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Task is overdue
    if (dueDate < today) {
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Send reminder every 3 days for overdue tasks, but only once per day to prevent spam.
      // Trigger on the USER's 9am (userNow), not the server's 9am-UTC (which is 5am ET).
      if (daysOverdue % 3 === 0 && userNow.getHours() === 9 && userNow.getMinutes() < 15) {
        notifications.push({
          user_id: userId,
          task_id: task.id,
          notification_type: 'overdue_reminder',
          title: `Task Overdue (${daysOverdue} days)`,
          body: `"${task.title}" was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`,
          scheduled_for: new Date(now.getTime() + 5 * 60 * 1000).toISOString() // 5 minutes from now
        });
      }
    }
  }

  return notifications;
}

function generateDailyDigest(tasks: Task[], userId: string, now: Date): any | null {
  const totalTasks = tasks.length;
  const urgentTasks = tasks.filter(t => t.priority === 'URGENT').length;
  const dueTodayTasks = tasks.filter(t => {
    if (!t.due_date) return false;
    const dueDate = new Date(t.due_date);
    const today = new Date(now);
    return dueDate.toDateString() === today.toDateString();
  }).length;

  if (totalTasks === 0) return null;

  return {
    user_id: userId,
    notification_type: 'daily_digest',
    title: 'Daily Task Summary',
    body: `You have ${totalTasks} active tasks${urgentTasks > 0 ? `, ${urgentTasks} urgent` : ''}${dueTodayTasks > 0 ? `, ${dueTodayTasks} due today` : ''}`,
    scheduled_for: new Date(now.getTime() + 15 * 60 * 1000).toISOString() // 15 minutes from now
  };
}

function generateWeeklyDigest(tasks: Task[], userId: string, now: Date): any | null {
  const totalTasks = tasks.length;
  const completedThisWeek = 0; // Would need to calculate from completed tasks
  const priorityBreakdown = {
    URGENT: tasks.filter(t => t.priority === 'URGENT').length,
    HIGH: tasks.filter(t => t.priority === 'HIGH').length,
    MEDIUM: tasks.filter(t => t.priority === 'MEDIUM').length,
    LOW: tasks.filter(t => t.priority === 'LOW').length,
  };

  return {
    user_id: userId,
    notification_type: 'weekly_digest',
    title: 'Weekly Productivity Summary',
    body: `This week: ${completedThisWeek} completed, ${totalTasks} active tasks. ${priorityBreakdown.URGENT} urgent items need attention.`,
    scheduled_for: new Date(now.getTime() + 20 * 60 * 1000).toISOString() // 20 minutes from now
  };
}

function shouldSendDailyDigest(userNow: Date): boolean {
  // Send daily digest at 8 AM in the USER's timezone (caller passes userNow)
  return userNow.getHours() === 8 && userNow.getMinutes() < 15;
}

function shouldSendWeeklyDigest(userNow: Date): boolean {
  // Send weekly digest on Sunday at 9 AM in the USER's timezone (caller passes userNow)
  return userNow.getDay() === 0 && userNow.getHours() === 9 && userNow.getMinutes() < 15;
}

async function generateCalendarEventReminders(
  supabaseClient: any,
  prefs: NotificationPrefs,
  now: Date,
  inQuietHours: boolean
): Promise<any[]> {
  const notifications: any[] = [];
  const leadMinutes = prefs.calendar_reminder_minutes || 15;
  
  // Look for events starting within the next (leadMinutes + 5) minutes
  const windowEnd = new Date(now.getTime() + (leadMinutes + 5) * 60 * 1000);
  
  const { data: events, error } = await supabaseClient
    .from('external_calendar_events')
    .select('*')
    .eq('user_id', prefs.user_id)
    .gt('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString());

  if (error) {
    console.error(`Error fetching calendar events for user ${prefs.user_id}:`, error);
    return notifications;
  }

  if (!events || events.length === 0) return notifications;

  for (const event of events) {
    // Calculate when the reminder should fire
    const eventStart = new Date(event.start_time);
    let scheduledFor = new Date(eventStart.getTime() - leadMinutes * 60 * 1000);
    
    // If the reminder time is in the past, schedule for now + 1 min
    if (scheduledFor <= now) {
      scheduledFor = new Date(now.getTime() + 60 * 1000);
    }

    // Check for existing reminder to avoid duplicates
    const { data: existing } = await supabaseClient
      .from('scheduled_notifications')
      .select('id')
      .eq('user_id', prefs.user_id)
      .eq('notification_type', 'calendar_event_reminder')
      .filter('metadata->>external_event_id', 'eq', event.external_event_id)
      .is('failed_at', null)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Handle quiet hours — defer to after quiet hours end
    let queuedDuringQuiet = false;
    let originalScheduledFor = null;
    if (inQuietHours) {
      originalScheduledFor = scheduledFor.toISOString();
      scheduledFor = getQuietHoursEnd(scheduledFor, prefs);
      queuedDuringQuiet = true;
    }

    notifications.push({
      user_id: prefs.user_id,
      notification_type: 'calendar_event_reminder',
      title: `📅 ${event.title}`,
      body: `Starting in ${leadMinutes} minutes${event.location ? ` • ${event.location}` : ''}`,
      scheduled_for: scheduledFor.toISOString(),
      queued_during_quiet: queuedDuringQuiet,
      original_scheduled_for: originalScheduledFor,
      metadata: {
        external_event_id: event.external_event_id,
        event_start: event.start_time,
        event_end: event.end_time,
        calendar_id: event.calendar_id,
        channels: prefs.calendar_reminder_channels || ['PUSH']
      }
    });
  }

  console.log(`Generated ${notifications.length} calendar event reminders for user ${prefs.user_id}`);
  return notifications;
}

async function processPendingNotifications(supabaseClient: any, now: Date): Promise<void> {
  console.log('Processing pending notifications...');
  
  // Get notifications that should be sent now
  const { data: pendingNotifications, error } = await supabaseClient
    .from('scheduled_notifications')
    .select('*')
    .lte('scheduled_for', now.toISOString())
    .is('delivered_at', null)
    .is('failed_at', null)
    .limit(50);

  if (error) {
    console.error('Error fetching pending notifications:', error);
    return;
  }

  console.log(`Found ${pendingNotifications?.length || 0} pending notifications`);

  for (const notification of pendingNotifications || []) {
    try {
      // Get user's notification preferences including Slack webhook
      const { data: prefs, error: prefsError } = await supabaseClient
        .from('notification_prefs')
        .select('*')
        .eq('user_id', notification.user_id)
        .maybeSingle();

      if (prefsError && prefsError.code !== 'PGRST116') {
        console.error('Error fetching user preferences:', prefsError);
      }

      const userChannels = prefs?.channels || ['WEB_PUSH', 'IN_APP'];

      // Send to push notification service (handles all channels now)
      const { error: sendError } = await supabaseClient.functions.invoke('send-push-notification', {
        body: {
          userId: notification.user_id,
          title: notification.title,
          body: notification.body,
          data: {
            type: notification.notification_type,
            taskId: notification.task_id,
            notificationId: notification.id
          }
        }
      });

      if (sendError) {
        console.error('Error sending notification:', sendError);
        
        // Mark as failed
        await supabaseClient
          .from('scheduled_notifications')
          .update({
            failed_at: now.toISOString(),
            failure_reason: sendError.message
          })
          .eq('id', notification.id);
      } else {
        // Mark as delivered
        await supabaseClient
          .from('scheduled_notifications')
          .update({
            delivered_at: now.toISOString()
          })
          .eq('id', notification.id);
        
        console.log(`Notification ${notification.id} sent successfully to all channels`);
      }
    } catch (error) {
      console.error(`Error processing notification ${notification.id}:`, error);
      
        // Mark as failed
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await supabaseClient
          .from('scheduled_notifications')
          .update({
            failed_at: now.toISOString(),
            failure_reason: errorMessage
          })
          .eq('id', notification.id);
    }
  }
}