import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TaskReminderRequest {
  taskId: string;
  userId: string;
  dueDate?: string;
  title: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { taskId, userId, dueDate, title }: TaskReminderRequest = await req.json();

    if (!taskId || !userId || !title) {
      return new Response(
        JSON.stringify({ error: 'taskId, userId, and title are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const now = new Date();
    const reminders = [];

    // Generate reminders if task has a due date
    if (dueDate) {
      const taskDueDate = new Date(dueDate);
      
      // 15 minutes before due date reminder
      const fifteenMinutesBefore = new Date(taskDueDate.getTime() - 15 * 60 * 1000);
      if (fifteenMinutesBefore > now) {
        reminders.push({
          user_id: userId,
          task_id: taskId,
          notification_type: 'due_reminder_15min',
          title: 'Task Due in 15 Minutes',
          body: `"${title}" is due in 15 minutes`,
          scheduled_for: fifteenMinutesBefore.toISOString()
        });
      }

      // At due time reminder
      if (taskDueDate > now) {
        reminders.push({
          user_id: userId,
          task_id: taskId,
          notification_type: 'due_reminder_now',
          title: 'Task Due Now',
          body: `"${title}" is due now`,
          scheduled_for: taskDueDate.toISOString()
        });
      }

      // 1 day before due date reminder (for tasks due more than 1 day away)
      const oneDayBefore = new Date(taskDueDate.getTime() - 24 * 60 * 60 * 1000);
      if (oneDayBefore > now) {
        reminders.push({
          user_id: userId,
          task_id: taskId,
          notification_type: 'due_reminder_1day',
          title: 'Task Due Tomorrow',
          body: `"${title}" is due tomorrow`,
          scheduled_for: oneDayBefore.toISOString()
        });
      }
    }

    // Insert all reminders
    if (reminders.length > 0) {
      const { error } = await supabaseClient
        .from('scheduled_notifications')
        .insert(reminders);

      if (error) {
        console.error('Error scheduling reminders:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to schedule reminders', details: error.message }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      console.log(`Scheduled ${reminders.length} reminders for task ${taskId}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        remindersScheduled: reminders.length,
        reminders: reminders.map(r => ({
          type: r.notification_type,
          scheduledFor: r.scheduled_for
        }))
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in generate-task-reminders function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});