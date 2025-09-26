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
        status: 'TODO',
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

    // Generate automatic reminders
    await generateTaskReminders(supabaseClient, task, now);

    return new Response(
      JSON.stringify({ 
        success: true, 
        task,
        message: `Test task created successfully. Due at ${dueDate.toLocaleString()}`,
        remindersScheduled: true
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

  // 15 minutes before due date reminder
  const fifteenMinutesBefore = new Date(dueDate.getTime() - 15 * 60 * 1000);
  if (fifteenMinutesBefore > now) {
    reminders.push({
      user_id: task.user_id,
      task_id: task.id,
      notification_type: 'due_reminder_15min',
      title: 'Task Due in 15 Minutes',
      body: `"${task.title}" is due in 15 minutes`,
      scheduled_for: fifteenMinutesBefore.toISOString()
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