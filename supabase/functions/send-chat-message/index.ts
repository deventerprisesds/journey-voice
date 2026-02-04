import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ChatMessageRequest {
  userId: string;
  message?: string;              // Direct message OR...
  generateFromContext?: {        // ...AI-generated message
    callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
    context?: string;
  };
  sendPush?: boolean;            // Whether to send push notification (default: true)
  assistantId?: string;          // Optional assistant ID
}

// Get today's tasks for briefing context
async function getTodaysBriefing(supabase: any, userId: string): Promise<string> {
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('title, start_time, priority, category, status')
    .eq('user_id', userId)
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: true });

  if (error || !tasks || tasks.length === 0) {
    return 'your daily schedule';
  }

  const taskCount = tasks.length;
  const highPriorityCount = tasks.filter((t: any) => t.priority === 'HIGH' || t.priority === 'URGENT').length;
  const completedCount = tasks.filter((t: any) => t.status === 'DONE').length;
  
  let briefing = `${taskCount} task${taskCount > 1 ? 's' : ''} scheduled for today`;
  if (highPriorityCount > 0) {
    briefing += `, including ${highPriorityCount} high priority item${highPriorityCount > 1 ? 's' : ''}`;
  }
  if (completedCount > 0) {
    briefing += `. ${completedCount} already completed`;
  }
  
  return briefing;
}

// Build contextual instructions based on call type
async function buildCallContext(callType: string, context: string | undefined, userId: string, supabase: any): Promise<string> {
  const briefing = await getTodaysBriefing(supabase, userId);
  const userContext = context || '';
  
  switch (callType) {
    case 'morning_standup':
      return `[SYSTEM INITIATED] Morning Stand-up Check-in
      
You are proactively reaching out to the user for their morning stand-up.

AGENDA:
1. Greet warmly and mention it's the morning check-in
2. Share today's schedule overview: ${briefing}
3. Highlight any high-priority or urgent tasks
4. Ask if there's anything they want to add to today's schedule
5. Ask if there are any blockers or concerns for today

USER NOTES: ${userContext}

Keep your opening message concise and actionable.`;

    case 'midday_checkin':
      return `[SYSTEM INITIATED] Midday Check-in

You are proactively reaching out to the user for their midday check-in.

AGENDA:
1. Greet and mention it's the midday check-in
2. Ask how the day is going so far
3. Check on progress: ${briefing}
4. Ask if anything is blocking progress or needs rescheduling
5. Offer help with any tasks

USER NOTES: ${userContext}

Keep your opening message friendly and focused on their day.`;

    case 'eod_wrapup':
      return `[SYSTEM INITIATED] End of Day Wrap-up

You are proactively reaching out to the user for their end of day wrap-up.

AGENDA:
1. Acknowledge the end of the workday
2. Summarize what was accomplished today: ${briefing}
3. Note any tasks that weren't completed
4. Ask what priorities should be for tomorrow
5. Wish them a good evening

USER NOTES: ${userContext}

Keep your opening message warm and reflective.`;

    case 'custom':
    default:
      if (!userContext) {
        return `[SYSTEM INITIATED] Scheduled Check-in

You are proactively reaching out to the user for a scheduled check-in. Ask what they need help with.`;
      }
      
      return `[SYSTEM INITIATED] Custom Scheduled Check-in

${userContext}

Start with a friendly greeting and address the context above.`;
  }
}

// Truncate text for notification body
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, message, generateFromContext, sendPush = true, assistantId } = await req.json() as ChatMessageRequest;

    if (!userId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'userId is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[SEND-CHAT-MESSAGE] Processing for user ${userId}, generateFromContext:`, generateFromContext);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get or create the user's active chat thread
    const { data: existingThread } = await supabase
      .from('ai_threads')
      .select('id, openai_thread_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let dbThreadId = existingThread?.id;

    if (!dbThreadId) {
      // Create a new thread
      const { data: newThread, error: createError } = await supabase
        .from('ai_threads')
        .insert({
          user_id: userId,
          openai_thread_id: `pending_${Date.now()}`, // Will be created on first API call
          mode: 'chat'
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[SEND-CHAT-MESSAGE] Failed to create thread:', createError);
        throw new Error('Failed to create conversation thread');
      }
      dbThreadId = newThread.id;
      console.log('[SEND-CHAT-MESSAGE] Created new thread:', dbThreadId);
    }

    // 2. Generate message content if needed
    let content = message;
    let callType: string | undefined;

    if (!content && generateFromContext) {
      callType = generateFromContext.callType;
      const contextualInstructions = await buildCallContext(
        callType,
        generateFromContext.context,
        userId,
        supabase
      );

      console.log('[SEND-CHAT-MESSAGE] Generating AI response with context');

      // Call hybrid-assistant-api to generate the response
      const response = await fetch(`${supabaseUrl}/functions/v1/hybrid-assistant-api`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userInput: '[SYSTEM INITIATED] Generate your opening message for this check-in.',
          userId,
          threadId: dbThreadId,
          contextualInstructions,
          systemInitiated: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SEND-CHAT-MESSAGE] AI API error:', errorText);
        throw new Error('Failed to generate AI response');
      }

      const aiResult = await response.json();
      content = aiResult.response;
      console.log('[SEND-CHAT-MESSAGE] Generated AI response:', content?.substring(0, 100));
    }

    if (!content) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No message content provided or generated' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Store the message in conversation_messages
    const { data: storedMessage, error: storeError } = await supabase
      .from('conversation_messages')
      .insert({
        thread_id: dbThreadId,
        user_id: userId,
        role: 'assistant',
        content,
        source: 'chat',
        assistant_id: assistantId || null,
        metadata: {
          system_initiated: true,
          trigger: callType || 'direct',
          sent_at: new Date().toISOString()
        }
      })
      .select('id')
      .single();

    if (storeError) {
      console.error('[SEND-CHAT-MESSAGE] Failed to store message:', storeError);
      throw new Error('Failed to store message in database');
    }

    console.log('[SEND-CHAT-MESSAGE] Message stored with ID:', storedMessage.id);

    // 4. Send push notification if requested
    let pushResult = null;
    if (sendPush) {
      console.log('[SEND-CHAT-MESSAGE] Sending push notification');
      
      const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          title: 'Iris',
          body: truncateText(content, 100),
          data: {
            type: 'chat_message',
            callType: callType || 'direct',
            openCommsConsole: true,
            threadId: dbThreadId,
            messageId: storedMessage.id
          }
        })
      });

      pushResult = await pushResponse.json();
      console.log('[SEND-CHAT-MESSAGE] Push notification result:', pushResult);
    }

    return new Response(JSON.stringify({
      success: true,
      threadId: dbThreadId,
      messageId: storedMessage.id,
      content,
      pushSent: sendPush,
      pushResult
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SEND-CHAT-MESSAGE] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
