import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateQuickTestTaskRequest {
  userId: string;
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

    const { userId }: CreateQuickTestTaskRequest = await req.json();

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
    const startTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
    const endTime = new Date(now.getTime() + 6 * 60 * 1000); // 6 minutes from now
    const taskTitle = "🚀 Quick Test Task - Starting in 5 minutes";

    console.log('Creating quick test task at:', now.toISOString());
    console.log('Task will start at:', startTime.toISOString());

    // Get or create a default board for the user
    let targetBoardId;
    
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

    // Create the test task with start_time and end_time
    const { data: task, error: taskError } = await supabaseClient
      .from('tasks')
      .insert({
        title: taskTitle,
        description: `This is a quick test task to verify notifications work immediately. Created at ${now.toLocaleString()} and will start at ${startTime.toLocaleString()}.`,
        board_id: targetBoardId,
        user_id: userId,
        priority: 'HIGH',
        category: 'LIFE',
        status: 'BACKLOG',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        estimate_minutes: 1
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

    console.log('Quick test task created:', task);

    // Generate custom reminders with 1 minute before and at start time
    const { data: reminderData, error: reminderError } = await supabaseClient.functions.invoke('generate-task-reminders', {
      body: {
        taskId: task.id,
        userId: userId,
        title: task.title,
        startTime: startTime.toISOString(),
        reminderMinutes: 1 // 1 minute before instead of 15
      }
    });

    if (reminderError) {
      console.error('Error generating reminders:', reminderError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate reminders', details: reminderError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Reminders generated:', reminderData);

    // Immediately run the scheduler to process these new reminders
    const { data: schedulerData, error: schedulerError } = await supabaseClient.functions.invoke('notification-scheduler', {
      body: { trigger: 'quick_test', immediate: true }
    });

    if (schedulerError) {
      console.error('Error running scheduler:', schedulerError);
    } else {
      console.log('Scheduler run result:', schedulerData);
    }

    // Immediately run the delivery to send any ready notifications
    const { data: deliveryData, error: deliveryError } = await supabaseClient.functions.invoke('notification-delivery', {
      body: { trigger: 'quick_test' }
    });

    if (deliveryError) {
      console.error('Error running delivery:', deliveryError);
    } else {
      console.log('Delivery run result:', deliveryData);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        task,
        message: `Quick test task created! It will start at ${startTime.toLocaleString()}`,
        reminders: reminderData?.reminders || [],
        schedulerRun: schedulerData,
        deliveryRun: deliveryData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in create-quick-test-task function:', error);
    
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