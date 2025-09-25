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
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting notification scheduler...');

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

    // Process any pending notifications that should be sent now
    await processPendingNotifications(supabaseClient, now);

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
  
  // Check if we're in quiet hours
  if (isInQuietHours(now, prefs)) {
    console.log(`User ${prefs.user_id} is in quiet hours, skipping notifications`);
    return notifications;
  }

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

  // Process due date reminders
  if (prefs.due_reminders_enabled) {
    const dueReminders = generateDueReminders(tasks || [], prefs.user_id, now);
    notifications.push(...dueReminders);
  }

  // Process overdue reminders
  if (prefs.overdue_reminders_enabled) {
    const overdueReminders = generateOverdueReminders(tasks || [], prefs.user_id, now);
    notifications.push(...overdueReminders);
  }

  // Process daily digest (check if it's the right time)
  if (prefs.daily_digest_enabled && shouldSendDailyDigest(now)) {
    const dailyDigest = generateDailyDigest(tasks || [], prefs.user_id, now);
    if (dailyDigest) notifications.push(dailyDigest);
  }

  // Process weekly digest (check if it's the right time)
  if (prefs.weekly_digest_enabled && shouldSendWeeklyDigest(now)) {
    const weeklyDigest = generateWeeklyDigest(tasks || [], prefs.user_id, now);
    if (weeklyDigest) notifications.push(weeklyDigest);
  }

  return notifications;
}

function isInQuietHours(now: Date, prefs: NotificationPrefs): boolean {
  const currentTime = now.toTimeString().substring(0, 5); // HH:MM format
  const quietStart = prefs.quiet_hours_start;
  const quietEnd = prefs.quiet_hours_end;

  // Handle same-day quiet hours (e.g., 22:00 - 08:00)
  if (quietStart > quietEnd) {
    return currentTime >= quietStart || currentTime <= quietEnd;
  }
  // Handle within-day quiet hours (e.g., 12:00 - 14:00)
  return currentTime >= quietStart && currentTime <= quietEnd;
}

function generateDueReminders(tasks: Task[], userId: string, now: Date): any[] {
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
      notifications.push({
        user_id: userId,
        task_id: task.id,
        notification_type: 'due_reminder',
        title: 'Task Due Tomorrow',
        body: `"${task.title}" is due tomorrow`,
        scheduled_for: new Date(now.getTime() + 5 * 60 * 1000).toISOString() // 5 minutes from now
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

function generateOverdueReminders(tasks: Task[], userId: string, now: Date): any[] {
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
      
      // Send reminder every 3 days for overdue tasks
      if (daysOverdue % 3 === 0) {
        notifications.push({
          user_id: userId,
          task_id: task.id,
          notification_type: 'overdue_reminder',
          title: `Task Overdue (${daysOverdue} days)`,
          body: `"${task.title}" was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`,
          scheduled_for: new Date(now.getTime() + 10 * 60 * 1000).toISOString() // 10 minutes from now
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

function shouldSendDailyDigest(now: Date): boolean {
  // Send daily digest at 8 AM
  return now.getHours() === 8 && now.getMinutes() < 15;
}

function shouldSendWeeklyDigest(now: Date): boolean {
  // Send weekly digest on Sunday at 9 AM
  return now.getDay() === 0 && now.getHours() === 9 && now.getMinutes() < 15;
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
      // Send push notification
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
        
        console.log(`Notification ${notification.id} sent successfully`);
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