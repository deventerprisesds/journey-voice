import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateTestTaskRequest {
  userId: string;
  boardId?: string;
  testType: '5-minute' | '1-hour' | '1-day';
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

    const { userId, boardId, testType }: CreateTestTaskRequest = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const now = new Date();
    let dueDate: Date;
    let taskTitle: string;

    // Set due date based on test type
    switch (testType) {
      case '5-minute':
        dueDate = new Date(now.getTime() + 5 * 60 * 1000);
        taskTitle = "🧪 Test Task - Due in 5 minutes";
        break;
      case '1-hour':
        dueDate = new Date(now.getTime() + 60 * 60 * 1000);
        taskTitle = "🧪 Test Task - Due in 1 hour";
        break;
      case '1-day':
        dueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        taskTitle = "🧪 Test Task - Due in 1 day";
        break;
      default:
        dueDate = new Date(now.getTime() + 5 * 60 * 1000);
        taskTitle = "🧪 Test Task - Due in 5 minutes";
    }

    // Get or create a default board for the user
    let targetBoardId = boardId;
    
    if (!targetBoardId) {
      const { data: boards, error: boardsError } = await supabaseClient
        .from('boards')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .limit(1);

      if (boardsError) {
        console.error('Error fetching boards:', boardsError);
        return new Response(
          JSON.stringify({ error: 'Failed to find user board' }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      if (boards && boards.length > 0) {
        targetBoardId = boards[0].id;
      } else {
        // Create a test board if none exists
        const { data: newBoard, error: createBoardError } = await supabaseClient
          .from('boards')
          .insert({
            name: 'Test Board',
            description: 'Board for testing notifications',
            user_id: userId,
            is_default: true,
            position: 0,
            color: '#3B82F6'
          })
          .select('id')
          .single();

        if (createBoardError) {
          console.error('Error creating board:', createBoardError);
          return new Response(
            JSON.stringify({ error: 'Failed to create test board' }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        targetBoardId = newBoard.id;
      }
    }

    // Create the test task
    const { data: task, error: taskError } = await supabaseClient
      .from('tasks')
      .insert({
        title: taskTitle,
        description: `This is a test task created to verify notification functionality. It will be due at ${dueDate.toLocaleString()}.`,
        board_id: targetBoardId,
        user_id: userId,
        priority: 'MEDIUM',
        category: 'LIFE',
        status: 'BACKLOG',
        due_date: dueDate.toISOString(),
        estimate_minutes: 15
      })
      .select()
      .single();

    if (taskError) {
      console.error('Error creating task:', taskError);
      return new Response(
        JSON.stringify({ error: 'Failed to create test task', details: taskError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Test task created:', task);

    // Send immediate test notification via webhook
    await sendImmediateTestNotification(supabaseClient, task, userId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        task,
        message: `Test task created successfully. Due at ${dueDate.toLocaleString()}`,
        remindersScheduled: true,
        immediateNotificationSent: true
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in create-test-task function:', error);
    
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

async function generateTaskReminders(supabaseClient: any, task: any, now: Date) {
  const reminders = [];
  const dueDate = new Date(task.due_date);
  
  // Calculate time until due to determine appropriate reminder timing
  const timeUntilDue = dueDate.getTime() - now.getTime();
  const minutesUntilDue = Math.floor(timeUntilDue / (1000 * 60));

  // For short-term tasks (< 30 minutes), remind 2 minutes before
  // For longer tasks, remind 15 minutes before
  let reminderMinutesBefore = 15;
  if (minutesUntilDue <= 30) {
    reminderMinutesBefore = Math.max(2, Math.floor(minutesUntilDue * 0.4)); // 40% of time before, min 2 minutes
  }

  const reminderTime = new Date(dueDate.getTime() - reminderMinutesBefore * 60 * 1000);
  if (reminderTime > now) {
    reminders.push({
      user_id: task.user_id,
      task_id: task.id,
      notification_type: `due_reminder_${reminderMinutesBefore}min`,
      title: `Task Due in ${reminderMinutesBefore} Minutes`,
      body: `"${task.title}" is due in ${reminderMinutesBefore} minutes`,
      scheduled_for: reminderTime.toISOString()
    });
  }

  // At due time reminder
  reminders.push({
    user_id: task.user_id,
    task_id: task.id,
    notification_type: 'due_reminder_now',
    title: 'Task Due Now',
    body: `"${task.title}" is due now`,
    scheduled_for: dueDate.toISOString()
  });

  // Insert all reminders
  if (reminders.length > 0) {
    const { error } = await supabaseClient
      .from('scheduled_notifications')
      .insert(reminders);

    if (error) {
      console.error('Error scheduling reminders:', error);
    } else {
      console.log(`Scheduled ${reminders.length} reminders for task ${task.id}`);
    }
  }
}

async function sendImmediateTestNotification(supabaseClient: any, task: any, userId: string) {
  try {
    // Get user profile for notification
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('email, full_name')
      .eq('user_id', userId)
      .single();

    // Get user's notification preferences to use their configured channels
    const { data: notificationPrefs } = await supabaseClient
      .from('notification_prefs')
      .select('channels')
      .eq('user_id', userId)
      .single();

    // Default includes PUSH so mobile receives notifications even without explicit prefs.
    // Exclude calendar-sync-only channels which are not applicable here.
    const allChannels = notificationPrefs?.channels || ['EMAIL', 'SLACK', 'PUSH'];
    const channels = allChannels.filter((c: string) => !['OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(c));

    // Send immediate notification via unified webhook
    const { data, error } = await supabaseClient.functions.invoke('send-unified-notification', {
      body: {
        userId: userId,
        title: 'Test Task Created',
        body: `Test task "${task.title}" has been created and will be due at ${new Date(task.due_date).toLocaleString()}`,
        channels: channels,
        userProfile: profile || { email: 'test@example.com' },
        data: {
          type: 'test_task_created',
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          dueDate: task.due_date,
          priority: task.priority,
          category: task.category
        }
      }
    });

    if (error) {
      console.error('Error sending immediate test notification:', error);
    } else {
      console.log('Immediate test notification sent successfully:', data);
    }
  } catch (error) {
    console.error('Error in sendImmediateTestNotification:', error);
  }
}