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

// Helper to log activity (fire-and-forget)
async function logActivity(
  supabase: any,
  userId: string,
  activityType: string,
  status: 'started' | 'completed' | 'error',
  stage?: string,
  metadata?: Record<string, unknown>,
  errorMessage?: string,
  errorCode?: string
): Promise<void> {
  try {
    await supabase.from('activity_log').insert({
      user_id: userId,
      activity_type: activityType,
      status,
      stage: stage || null,
      error_message: errorMessage || null,
      error_code: errorCode || null,
      session_id: `EF-${Date.now().toString(36)}`,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        source: 'edge_function',
        function: 'send-chat-message'
      }
    });
  } catch (err) {
    // Silent failure - don't let logging break the main flow
    console.error('[ACTIVITY_LOG] Failed to log:', err);
  }
}

// Map categories to window affinities
const CATEGORY_WINDOW_MAPPING: Record<string, string[]> = {
  'CAREER': ['business_hours'],
  'PROF_EDUCATION': ['after_work', 'evening', 'weekends'],
  'EDUCATION': ['business_hours', 'after_work'],
  'VENTURES': ['after_work', 'evening', 'weekends'],
  'LIFE': ['morning', 'after_work', 'evening', 'weekends'],
  'PERSONAL': ['morning', 'after_work', 'evening', 'weekends'],
};

// Window time ranges
const WINDOW_RANGES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
  weekends: { start: 10, end: 20 }
};

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

// Get tasks for a specific time window
async function getTasksForWindow(
  supabase: any, 
  userId: string, 
  window: string
): Promise<any[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, start_time, priority, category, status')
    .eq('user_id', userId)
    .neq('status', 'BLOCKED')
    .neq('status', 'DONE')
    .not('title', 'ilike', '%test%')
    .or(`start_time.gte.${today.toISOString()},due_date.gte.${today.toISOString().split('T')[0]}`)
    .order('start_time', { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  const windowRange = WINDOW_RANGES[window];
  if (!windowRange) return data;

  return data.filter((task: any) => {
    const category = task.category || 'LIFE';
    const categoryWindows = CATEGORY_WINDOW_MAPPING[category] || ['flexible'];
    
    if (!categoryWindows.includes(window) && !categoryWindows.includes('flexible')) {
      return false;
    }

    if (task.start_time) {
      const taskHour = new Date(task.start_time).getHours();
      return taskHour >= windowRange.start && taskHour < windowRange.end;
    }

    return true;
  });
}

// Get topics for memory jog fallback
async function getTopicsForWindow(
  supabase: any, 
  userId: string, 
  window: string
): Promise<any[]> {
  const { data } = await supabase
    .from('task_topic_index')
    .select('topic_name, topic_summary, example_tasks')
    .eq('user_id', userId)
    .contains('window_affinity', [window])
    .order('task_count', { ascending: false })
    .limit(5);
  
  return data || [];
}

// Format task list
function formatTaskList(tasks: any[]): string {
  if (tasks.length === 0) return 'No tasks scheduled';
  
  return tasks.slice(0, 10).map((t: any, i: number) => {
    const time = t.start_time ? new Date(t.start_time).toLocaleTimeString('en-US', { 
      hour: 'numeric', minute: '2-digit', hour12: true 
    }) : 'Unscheduled';
    return `${i + 1}. ${t.title} (${time})`;
  }).join('\n');
}

// Build window transition context
async function buildWindowTransitionContext(
  context: string,
  userId: string, 
  window: string,
  supabase: any
): Promise<string> {
  const windowTasks = await getTasksForWindow(supabase, userId, window);
  
  let allDayTasks: any[] = [];
  if (window === 'morning') {
    const { data: dayTasks } = await supabase
      .from('tasks')
      .select('id, title, start_time, priority, category, status')
      .eq('user_id', userId)
      .neq('status', 'BLOCKED')
      .neq('status', 'DONE')
      .not('title', 'ilike', '%test%')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });
    
    allDayTasks = (dayTasks || []).filter((t: any) => {
      if (!t.start_time) return false;
      return new Date(t.start_time).getHours() >= 9;
    });
  }

  const windowLabel = window === 'morning' ? 'Morning'
    : window === 'business_hours' ? 'Business Hours'
    : window === 'after_work' ? 'After Work'
    : window === 'evening' ? 'Evening'
    : 'Weekend';

  if (windowTasks.length > 0 || (window === 'morning' && allDayTasks.length > 0)) {
    const taskList = formatTaskList(windowTasks);
    const restOfDayList = window === 'morning' && allDayTasks.length > 0 ? formatTaskList(allDayTasks) : '';

    let message = `[SYSTEM INITIATED] ${windowLabel} Check-in (Tasks Available)

Here are your ${windowLabel.toLowerCase()} tasks:
${taskList}`;

    if (restOfDayList) {
      message += `\n\nRest of day overview:\n${restOfDayList}`;
    }

    message += `\n\nWould you like to confirm these, adjust them, or skip?`;
    return message;
  } else {
    const topics = await getTopicsForWindow(supabase, userId, window);
    
    if (window === 'morning') {
      return `[SYSTEM INITIATED] ${windowLabel} Check-in

Good morning! I'm just checking in to help you get started with your day. I'll follow up in a few hours to go over your plans.`;
    }

    if (topics.length === 0) {
      return `[SYSTEM INITIATED] ${windowLabel} Check-in

You have no scheduled tasks for the ${windowLabel.toLowerCase()} window. Would you like me to help you plan something?`;
    }

    const topicList = topics.map((t: any) => `- ${t.topic_name}: ${t.topic_summary || 'Various tasks'}`).join('\n');
    
    return `[SYSTEM INITIATED] ${windowLabel} Check-in (Topic Jog)

You have no scheduled items for the ${windowLabel.toLowerCase()} window. To jog your memory, here are the main topics you've been working on:

${topicList}

Do you want to work on any of these right now?`;
  }
}

// Build contextual instructions based on call type
async function buildCallContext(callType: string, context: string | undefined, userId: string, supabase: any): Promise<string> {
  // Check for window marker
  const windowMatch = context?.match(/\[WINDOW:(\w+)\]/);
  
  if (windowMatch) {
    const window = windowMatch[1];
    console.log(`[SEND-CHAT] Detected window transition: ${window}`);
    return buildWindowTransitionContext(context, userId, window, supabase);
  }

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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let userId: string | null = null;

  try {
    const body = await req.json() as ChatMessageRequest;
    userId = body.userId;
    const { message, generateFromContext, sendPush = true, assistantId } = body;

    if (!userId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'userId is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log: Request received
    await logActivity(supabase, userId, 'chat_send', 'started', 'request_received', {
      hasMessage: !!message,
      hasGenerateFromContext: !!generateFromContext,
      callType: generateFromContext?.callType,
      sendPush,
      assistantId
    });

    console.log(`[SEND-CHAT-MESSAGE] Processing for user ${userId}, generateFromContext:`, generateFromContext, ', assistantId:', assistantId);

    // 1. Resolve effective assistant ID
    let effectiveAssistantId = assistantId;
    
    if (!effectiveAssistantId) {
      // Fall back to user's default assistant
      const { data: defaultAssistant } = await supabase
        .from('assistants')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .maybeSingle();
      
      effectiveAssistantId = defaultAssistant?.id || null;
      console.log('[SEND-CHAT-MESSAGE] Using default assistant:', effectiveAssistantId);
    }

    // Log: Assistant resolved
    await logActivity(supabase, userId, 'chat_send', 'completed', 'assistant_resolved', {
      effectiveAssistantId,
      wasProvided: !!assistantId
    });

    // 2. Get or create the user's active chat thread for this assistant
    const { data: existingThread } = await supabase
      .from('ai_threads')
      .select('id, openai_thread_id')
      .eq('user_id', userId)
      .eq('assistant_id', effectiveAssistantId) // Match by assistant for consistent threading
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let dbThreadId = existingThread?.id;

    if (!dbThreadId) {
      // Create a new thread for this user + assistant
      const { data: newThread, error: createError } = await supabase
        .from('ai_threads')
        .insert({
          user_id: userId,
          assistant_id: effectiveAssistantId,
          openai_thread_id: `pending_${Date.now()}`, // Will be created on first API call
          mode: 'unified'
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[SEND-CHAT-MESSAGE] Failed to create thread:', createError);
        await logActivity(supabase, userId, 'chat_send', 'error', 'thread_creation_failed', {
          error: createError.message
        }, createError.message, createError.code);
        throw new Error('Failed to create conversation thread');
      }
      dbThreadId = newThread.id;
      console.log('[SEND-CHAT-MESSAGE] Created new thread:', dbThreadId, 'for assistant:', effectiveAssistantId);
    }

    // Log: Thread resolved
    await logActivity(supabase, userId, 'chat_send', 'completed', 'thread_resolved', {
      dbThreadId,
      wasExisting: !!existingThread,
      assistantId: effectiveAssistantId
    });

    // 3. Generate message content if needed
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
      
      await logActivity(supabase, userId, 'chat_send', 'started', 'ai_generation', {
        callType
      });

      // Call hybrid-assistant-api to generate the response
      const response = await fetch(`${supabaseUrl}/functions/v1/hybrid-assistant-api`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userInput: `[SYSTEM INITIATED CHECK-IN]\n\n${contextualInstructions}\n\nGenerate your opening message for this check-in based on the context above.`,
          userId,
          threadId: dbThreadId,
          systemInitiated: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SEND-CHAT-MESSAGE] AI API error:', errorText);
        await logActivity(supabase, userId, 'chat_send', 'error', 'ai_generation_failed', {
          statusCode: response.status,
          errorPreview: errorText.substring(0, 200)
        }, errorText);
        throw new Error('Failed to generate AI response');
      }

      const aiResult = await response.json();
      content = aiResult.response;
      console.log('[SEND-CHAT-MESSAGE] Generated AI response:', content?.substring(0, 100));
      
      await logActivity(supabase, userId, 'chat_send', 'completed', 'ai_generation_success', {
        contentLength: content?.length,
        callType
      });
    }

    if (!content) {
      await logActivity(supabase, userId, 'chat_send', 'error', 'no_content', {});
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No message content provided or generated' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Store the message in conversation_messages WITH assistant_id
    const { data: storedMessage, error: storeError } = await supabase
      .from('conversation_messages')
      .insert({
        thread_id: dbThreadId,
        user_id: userId,
        role: 'assistant',
        content,
        source: 'chat',
        assistant_id: effectiveAssistantId, // Always set for proper UI filtering
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
      await logActivity(supabase, userId, 'chat_send', 'error', 'message_store_failed', {
        error: storeError.message
      }, storeError.message, storeError.code);
      throw new Error('Failed to store message in database');
    }

    console.log('[SEND-CHAT-MESSAGE] Message stored with ID:', storedMessage.id, 'assistant_id:', effectiveAssistantId);
    
    // Log: Message stored
    await logActivity(supabase, userId, 'chat_send', 'completed', 'message_stored', {
      messageId: storedMessage.id,
      threadId: dbThreadId,
      assistantId: effectiveAssistantId,
      contentLength: content.length
    });

    // 5. Check user presence before sending push notification
    let shouldSendPush = sendPush;
    let presenceData: { is_active: boolean | null; active_context: string | null } = {
      is_active: null,
      active_context: null
    };
    
    if (sendPush) {
      const { data: presence, error: presenceError } = await supabase
        .from('user_presence')
        .select('is_active, active_context')
        .eq('user_id', userId)
        .maybeSingle();
      
      presenceData = {
        is_active: presence?.is_active ?? null,
        active_context: presence?.active_context ?? null
      };
      
      // Log: Presence checked
      await logActivity(supabase, userId, 'chat_send', 'completed', 'presence_checked', {
        presenceFound: !!presence,
        presenceError: presenceError?.message,
        isActive: presenceData.is_active,
        activeContext: presenceData.active_context
      });
      
      // Skip push if user is active in chat
      if (presence?.is_active && presence?.active_context === 'chat') {
        console.log('[SEND-CHAT-MESSAGE] User active in chat, skipping push notification');
        shouldSendPush = false;
      }
    }

    // 6. Send push notification only if user is NOT active in chat
    let pushResult = null;
    if (shouldSendPush) {
      console.log('[SEND-CHAT-MESSAGE] Sending push notification (user not active in chat)');
      
      await logActivity(supabase, userId, 'chat_send', 'started', 'push_send', {
        reason: presenceData.is_active === null ? 'no_presence_record' : 'user_away'
      });
      
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
            messageId: storedMessage.id,
            // Include full message data for instant display (Slack/SMS model)
            messageData: {
              id: storedMessage.id,
              role: 'assistant',
              content,
              source: 'chat',
              assistant_id: effectiveAssistantId,
              created_at: new Date().toISOString(),
              thread_id: dbThreadId
            }
          }
        })
      });

      pushResult = await pushResponse.json();
      console.log('[SEND-CHAT-MESSAGE] Push notification result:', pushResult);
      
      // Log: Push result
      await logActivity(supabase, userId, 'chat_send', 'completed', 'push_sent', {
        pushSuccess: pushResult?.success ?? false,
        delivered: pushResult?.delivered ?? 0,
        failed: pushResult?.failed ?? 0,
        error: pushResult?.error
      });
    } else {
      // Log: Push skipped
      await logActivity(supabase, userId, 'chat_send', 'completed', 'push_skipped', {
        reason: 'user_active_in_chat',
        isActive: presenceData.is_active,
        activeContext: presenceData.active_context
      });
    }

    // Log: Complete success
    await logActivity(supabase, userId, 'chat_send', 'completed', 'complete', {
      messageId: storedMessage.id,
      threadId: dbThreadId,
      assistantId: effectiveAssistantId,
      pushSent: shouldSendPush,
      callType
    });

    return new Response(JSON.stringify({
      success: true,
      threadId: dbThreadId,
      messageId: storedMessage.id,
      assistantId: effectiveAssistantId,
      content,
      pushSent: shouldSendPush,
      pushResult
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SEND-CHAT-MESSAGE] Error:', error);
    
    // Log: Error
    if (userId) {
      await logActivity(supabase, userId, 'chat_send', 'error', 'exception', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      }, error instanceof Error ? error.message : 'Unknown error');
    }
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
