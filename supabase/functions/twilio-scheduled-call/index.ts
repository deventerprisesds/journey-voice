import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ScheduledCallConfig {
  userId?: string;
  callType: 'morning_briefing' | 'task_reminder' | 'custom';
  context?: string;
}

// Get today's tasks for briefing context
async function getTodaysBriefing(userId: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('title, start_time, priority, category')
    .eq('user_id', userId)
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: true });

  if (error || !tasks || tasks.length === 0) {
    return 'your daily schedule';
  }

  const taskCount = tasks.length;
  const highPriorityCount = tasks.filter(t => t.priority === 'HIGH' || t.priority === 'URGENT').length;
  
  let briefing = `${taskCount} task${taskCount > 1 ? 's' : ''} scheduled for today`;
  if (highPriorityCount > 0) {
    briefing += `, including ${highPriorityCount} high priority item${highPriorityCount > 1 ? 's' : ''}`;
  }
  
  return briefing;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let config: ScheduledCallConfig = { callType: 'morning_briefing' };
    
    // Try to parse body if present
    try {
      const body = await req.json();
      config = { ...config, ...body };
    } catch {
      // No body or invalid JSON, use defaults
    }

    // For cron jobs, we need to determine which user(s) to call
    // In a single-user setup, use MY_PHONE_NUMBER
    // In multi-user, you'd query users with scheduled calls enabled
    
    const phoneNumber = Deno.env.get('MY_PHONE_NUMBER');
    if (!phoneNumber) {
      console.log('No phone number configured for scheduled calls');
      return new Response(JSON.stringify({
        success: false,
        error: 'MY_PHONE_NUMBER not configured'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build context based on call type
    let context = config.context || '';
    
    if (config.callType === 'morning_briefing' && config.userId) {
      context = await getTodaysBriefing(config.userId);
    } else if (config.callType === 'morning_briefing') {
      context = 'your morning schedule briefing';
    }

    // Trigger the call via twilio-voice-handler
    const response = await fetch(`${supabaseUrl}/functions/v1/twilio-voice-handler`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'trigger-call',
        userId: config.userId,
        context,
        phoneNumber,
      }),
    });

    const result = await response.json();
    
    console.log('Scheduled call result:', result);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in twilio-scheduled-call:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
