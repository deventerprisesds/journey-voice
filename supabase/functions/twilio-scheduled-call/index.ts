// =============================================================================
// ARCHIVED: 2026-03-06
// This function is superseded by notification-delivery (queue-based path).
// All recurring call scheduling now goes through the scheduled_notifications
// table processed by notification-delivery. The recurring-calls-check cron
// job that called this function has been removed.
//
// Kept as reference for day-of-week guard logic and window-transition context
// building that was ported to notification-delivery.
// =============================================================================

/*
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCallContext, getTodaysBriefing } from '../_shared/call-context-builder.ts';

// Check if current time matches scheduled time (±1 minute tolerance)
function isTimeMatch(currentHHMM: string, scheduledTime: string): boolean {
  const [currentH, currentM] = currentHHMM.split(':').map(Number);
  const [scheduledH, scheduledM] = scheduledTime.split(':').map(Number);
  
  const currentMinutes = currentH * 60 + currentM;
  const scheduledMinutes = scheduledH * 60 + scheduledM;
  
  return Math.abs(currentMinutes - scheduledMinutes) <= 1;
}

// Format time in user's timezone
function getTimeInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

// Process recurring calls for all users
async function processRecurringCalls(): Promise<{ processed: number; triggered: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();
  const errors: string[] = [];
  let processed = 0;
  let triggered = 0;

  console.log('[RECURRING] Starting recurring calls check at:', now.toISOString());

  const { data: users, error: usersError } = await supabase
    .from('user_scheduling_prefs')
    .select('user_id, timezone, scheduled_calls, recurring_calls_enabled')
    .not('scheduled_calls', 'is', null);

  if (usersError) {
    console.error('[RECURRING] Error fetching users:', usersError);
    return { processed: 0, triggered: 0, errors: [usersError.message] };
  }

  if (!users || users.length === 0) {
    console.log('[RECURRING] No users with scheduled calls found');
    return { processed: 0, triggered: 0, errors: [] };
  }

  console.log('[RECURRING] Found ' + users.length + ' users with scheduled calls');

  for (const user of users) {
    const userId = user.user_id;
    const timezone = user.timezone || 'America/New_York';
    const scheduledCalls = (user.scheduled_calls as any[]) || [];

    if (user.recurring_calls_enabled === false) {
      console.log('[RECURRING] User ' + userId + ': Master toggle OFF, skipping all calls');
      continue;
    }

    if (scheduledCalls.length === 0) continue;

    const currentHHMM = getTimeInTimezone(now, timezone);
    console.log('[RECURRING] User ' + userId + ': timezone=' + timezone + ', current time=' + currentHHMM);

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, preferred_greeting')
      .eq('user_id', userId)
      .maybeSingle();

    const phoneNumber = profile?.phone;
    const preferredGreeting = profile?.preferred_greeting || 'Sir';
    if (!phoneNumber) {
      console.log('[RECURRING] User ' + userId + ': No phone number configured, skipping');
      continue;
    }

    for (const call of scheduledCalls) {
      if (!call.enabled) continue;

      // Weekend day-of-week guard
      const isWeekendCall = call.context?.includes('[WINDOW:weekends]');
      if (isWeekendCall) {
        const dayOfWeek = new Date().toLocaleDateString('en-US', { 
          weekday: 'long', timeZone: timezone 
        });
        if (dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday') {
          console.log('[RECURRING] Skipping weekend call "' + call.name + '" on ' + dayOfWeek);
          continue;
        }
      }

      processed++;

      if (isTimeMatch(currentHHMM, call.time)) {
        const commsMode = call.commsMode || 'phone';
        console.log('[RECURRING] User ' + userId + ': Triggering ' + call.name + ' at ' + call.time + ' via ' + commsMode);
        
        try {
          if (commsMode === 'app_message') {
            // ... app_message delivery logic
          } else if (commsMode === 'slack' || commsMode === 'email') {
            // ... unified notification delivery logic
          } else {
            // Phone call — use shared buildCallContext
            const context = await buildCallContext(
              { callType: call.callType, context: call.context, name: call.name },
              userId,
              supabaseUrl,
              supabaseServiceKey,
              preferredGreeting
            );

            // ... pre-connect + fallback trigger-call logic
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push('User ' + userId + ': Error triggering ' + call.name + ' - ' + errorMsg);
        }
      }
    }
  }

  console.log('[RECURRING] Completed: processed=' + processed + ', triggered=' + triggered + ', errors=' + errors.length);
  return { processed, triggered, errors };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let config = { callType: 'morning_briefing' };
    
    try {
      const body = await req.json();
      config = { ...config, ...body };
    } catch {
      // No body or invalid JSON, use defaults
    }

    if (config.trigger === 'cron' && config.checkRecurring) {
      console.log('[CRON] Processing recurring calls...');
      const result = await processRecurringCalls();
      
      return new Response(JSON.stringify({
        success: true,
        type: 'recurring_check',
        ...result
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ... legacy manual call trigger logic

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
*/

// Archived function - returns 410 Gone
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    success: false,
    error: 'This function has been archived. Recurring calls are now handled by notification-delivery.',
    archived_at: '2026-03-06'
  }), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
