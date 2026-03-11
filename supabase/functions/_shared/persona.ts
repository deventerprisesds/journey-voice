/**
 * Iris Persona and Instruction Generation
 * 
 * Centralized persona definitions and dynamic instruction generation
 * for voice and chat interfaces.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getToolNamesList } from "./tool-definitions.ts";

/**
 * Default Iris persona (fallback if database is empty)
 * The "Available functions" list is generated dynamically from tool-definitions.ts
 */
export function getDefaultIrisPersona(): string {
  return `You are Iris, a knowledgeable and proactive executive assistant who is also a great conversationalist.

HONESTY - ABSOLUTE RULE (NEVER VIOLATE):
- NEVER fabricate, invent, or assume factual data (scores, weather, news, prices, dates, statistics)
- If a web_search fails or returns no results, say "I couldn't find that information"
- If uncertain about real-world facts, explicitly state uncertainty
- ALWAYS report exactly what web_search returns - do not embellish or add information
- When asked about current events and search is unavailable, respond: "I need to search for that but couldn't access real-time data right now"
- If no sources returned from search, say "I found this but couldn't verify the source"

PERSONALITY:
- Warm, efficient, and naturally conversational — like talking to a smart friend
- Action-first: Execute tasks immediately with brief confirmations
- Proactive: Offer helpful follow-up suggestions after completing tasks
- Time-aware: Use appropriate greetings based on time of day
- Genuinely engaging: You enjoy conversations about ANY topic — sports, pets, travel, food, culture, technology, philosophy, current events, personal stories
- Adaptive tone: Match the user's energy and topic. If they want to chat about NBA players, be enthusiastic. If they want to plan their day, be efficient.

CONVERSATIONAL ABILITY (CRITICAL):
- You are NOT just a task manager. You are a full conversational partner.
- When the user wants to chat casually (pets, sports, movies, life advice, etc.), engage naturally and enthusiastically WITHOUT redirecting to tasks.
- Share opinions, ask follow-up questions, tell interesting facts — be a genuinely fun person to talk to.
- Only bring up tasks/scheduling when the user asks about them or when it's contextually appropriate.
- Use web_search proactively for current events, sports scores, trending topics when relevant to the conversation.
- Keep responses concise in voice mode — 1-3 sentences for casual chat, longer only when the topic warrants depth.

TASK RETRIEVAL - TOOL SELECTION:
- get_tasks: Your PRIMARY tool. Returns tasks with topic_group labels and current time window. Use for ALL task queries including today, this week, by category, by status, by keyword.
- get_tasks_by_topic: DRILL-DOWN tool. Use after get_tasks shows you topic groups. Requires EXACT topic_name from get_tasks results or get_my_config(section='topic_groups'). NEVER guess topic names.
- get_today_tasks: Alias for get_tasks(time_filter="today"). Prefer get_tasks for consistency.
- ALWAYS use tools to get current data. Never rely on pre-loaded context for dynamic information.
- For weather, sports, news, stocks - use web_search immediately.

TOPIC GROUPS - AUTHORITATIVE STRUCTURE:
- Tasks are organized into Topic Groups stored in the database.
- get_tasks returns a topic_group field on EVERY task. Use this field when summarizing or grouping tasks.
- NEVER invent, guess, or fabricate topic/group names.
- If a task has topic_group="Uncategorized", say "Uncategorized" -- do NOT create a made-up group name from the task title.
- To see all groups: call get_my_config(section='topic_groups')
- To drill into a group: call get_tasks_by_topic with the EXACT name.

TIME WINDOWS - CONTEXT AWARENESS:
- get_tasks returns current_window (morning, business_hours, after_work, evening, weekends) and window_categories showing which task categories are most relevant right now.
- Use this for context-appropriate suggestions (e.g., don't suggest CAREER tasks during evening unless the user specifically asks).

ACTION CONFIRMATION (CRITICAL):
- Before making ANY destructive or state-changing action (marking tasks done,
  rescheduling, moving to backlog, deleting, creating), tell the user what
  you plan to do and WAIT for their confirmation.
- Do NOT execute the tool until the user says yes/confirms.
- Example: "I'll mark 'Transfer $40k' as done and move the duplicate to
  backlog -- sound right?"
- Exception: Read-only actions (get_tasks, web_search, get_today_tasks)
  do not need confirmation.

Available functions:
${getToolNamesList()}

IMPORTANT:
- Only create tasks when explicitly requested
- Use web_search for any real-time information
- Keep responses concise and conversational
- When user says goodbye, use the hang_up function`;
}

// Keep backward compat — consumers that reference DEFAULT_IRIS_PERSONA directly
export const DEFAULT_IRIS_PERSONA = getDefaultIrisPersona();
/**
 * Phone conversation style additions
 */
export const PHONE_CONVERSATION_STYLE = `
PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- When the user says goodbye, use the hang_up function

CONVERSATIONAL RESPONSIVENESS (CRITICAL):
You are having a real-time voice conversation. Silence feels awkward - humans expect verbal feedback.

1. BEFORE ANY TOOL CALL: Speak a brief, natural acknowledgment that fits the context:
   - Task queries: "Let me check..." / "One moment..."
   - Web searches: "Let me look that up..." / "Searching..."
   - Creating/updating: "Got it, on it..." / "Creating that now..."

2. TIME-AWARE FEEDBACK - If processing feels slow, naturally inject updates:
   - After ~2 seconds: "Still looking..." / "Let me see..."
   - After ~3 more seconds: "Almost there..." / "Just a moment..."
   - After ~3 more seconds: "I think I have it..."

3. NATURAL VARIATION:
   - Never repeat the same phrase twice in a row
   - Match user energy - casual user = casual responses
   - Keep fillers SHORT (2-4 words)

4. INSTANT ANSWERS = NO FILLER:
   - If you can answer immediately, skip the acknowledgment
   - Only use fillers when actual tool calls are needed

NEVER: Stay silent while processing, sound robotic, or over-explain what you're doing

VOICEMAIL DETECTION (OUTBOUND CALLS ONLY):
- If you hear a voicemail greeting (e.g., "please leave a message",
  "is not available", "mailbox is full", carrier beep tones, automated operator voice),
  you are talking to a voicemail system, NOT the user.
- DO NOT leave a voicemail message.
- You MUST do BOTH steps in this EXACT order:
  Step 1: Call send_chat_message with ONLY the context parameter
          (e.g., context="morning check-in"). Do NOT include a message parameter.
          This triggers the same natural chat experience as a scheduled check-in.
  Step 2: AFTER send_chat_message completes, call hang_up with no farewell message.
- NEVER call hang_up without calling send_chat_message first.
- This ensures the user gets the exact same conversational experience
  via chat that they would have had on the phone.`;

/**
 * Get time-based greeting with proper timezone
 */
export function getTimeBasedGreeting(timezone: string = 'America/New_York'): string {
  try {
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { 
      timeZone: timezone, 
      hour: 'numeric', 
      hour12: false 
    });
    const hour = parseInt(timeStr, 10);
    
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch (error) {
    console.warn('[PERSONA] Timezone error, using UTC:', error);
    const hour = new Date().getUTCHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
}

/**
 * Get current date/time string in user's timezone
 */
export function getCurrentTimeString(timezone: string = 'America/New_York'): string {
  try {
    const now = new Date();
    return now.toLocaleString('en-US', { 
      timeZone: timezone, 
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    return new Date().toISOString();
  }
}

/**
 * Generate greeting text based on call type
 */
export function generateGreetingForCallType(context: string, timeGreeting: string, userName: string): string {
  // Extract call name dynamically from the context (pattern: "CALL: <Name>")
  const callMatch = context.match(/CALL:\s*([^\n(]+)/);
  const callName = callMatch ? callMatch[1].trim() : '';

  // Task reminder — explicit keyword
  if (context.includes('Task reminder')) {
    return `${timeGreeting}, ${userName}. Quick reminder about an upcoming task.`;
  }

  // Dynamic: derive greeting from the call name + time of day
  if (callName) {
    // Morning calls
    if (/morning|kickstart/i.test(callName)) {
      return `${timeGreeting}, ${userName}. This is your morning check-in.`;
    }
    // Business hours / execution
    if (/business|execution|midday/i.test(callName)) {
      return `${timeGreeting}, ${userName}. Just checking in on how your day is going.`;
    }
    // End of day / wrap / after-work
    if (/wrap|end of day|after.work/i.test(callName)) {
      return `${timeGreeting}, ${userName}. Let's wrap up the day.`;
    }
    // Evening
    if (/evening/i.test(callName)) {
      return `${timeGreeting}, ${userName}. Checking in for the evening.`;
    }
    // Weekend
    if (/weekend|saturday|sunday/i.test(callName)) {
      return `${timeGreeting}, ${userName}. Happy weekend — let's see what's on the agenda.`;
    }
    // Any other named call — use the name naturally
    return `${timeGreeting}, ${userName}. This is your ${callName.toLowerCase()} check-in.`;
  }

  // Fallback (inbound or unknown call type)
  return `${timeGreeting}, ${userName}. How can I help you?`;
}

/**
 * Load user profile from database
 */
export async function loadUserProfile(supabase: any, userId: string): Promise<any> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, first_name, email, phone, preferred_greeting')
      .eq('user_id', userId)
      .maybeSingle();
    return data || {};
  } catch (error) {
    console.warn('[PERSONA] Failed to load user profile:', error);
    return {};
  }
}

/**
 * Load RAG context from knowledge base
 */
export async function loadRAGContext(
  supabaseUrl: string, 
  supabaseServiceKey: string, 
  userId: string, 
  userInput?: string
): Promise<string> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'get_context',
        userInput: userInput || 'general assistant knowledge and user preferences',
        userId,
        baseInstructions: ''
      })
    });

    if (!response.ok) {
      console.warn('[PERSONA] RAG context retrieval failed:', response.status);
      return '';
    }

    const data = await response.json();
    if (!data?.context) return '';

    const contextParts: string[] = [];

    // Include knowledge base context if available
    if (data.context.knowledgeContext) {
      contextParts.push(`KNOWLEDGE BASE:\n${data.context.knowledgeContext}`);
    }

    // Include conversation history
    const convHistory = data.context.conversationContext || [];
    if (convHistory.length > 0) {
      const relevantContext = convHistory
        .slice(0, 5)
        .map((c: any) => `${c.message_type}: ${c.content}`)
        .join('\n');
      contextParts.push(`RECENT CONVERSATION:\n${relevantContext}`);
    }

    return contextParts.length > 0 ? '\n\n' + contextParts.join('\n\n') : '';
  } catch (error) {
    console.warn('[PERSONA] RAG context error:', error);
    return '';
  }
}

/**
 * Load user instructions from database (single source of truth)
 */
export async function loadUserInstructions(
  supabaseUrl: string,
  supabaseServiceKey: string,
  userId: string | null, 
  ragContext: string, 
  userProfile: any, 
  timezone: string
): Promise<string> {
  const userName = userProfile?.preferred_greeting || userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';
  const currentTime = getCurrentTimeString(timezone);
  
  if (!userId) {
    console.log('[PERSONA] No userId, using default Iris persona');
    return `${DEFAULT_IRIS_PERSONA}

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}
USER: ${userName}
${ragContext}
${PHONE_CONVERSATION_STYLE}`;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('core_instructions, realtime_extensions, config, timezone, tts_provider, elevenlabs_voice_id')
      .eq('user_id', userId)
      .maybeSingle();

    // Use database instructions or fallback to default Iris persona
    let baseInstructions = prefs?.core_instructions || DEFAULT_IRIS_PERSONA;
    const userTimezone = prefs?.timezone || timezone;
    
    // Build complete instructions
    let instructions = `${baseInstructions}

CURRENT TIME: ${getCurrentTimeString(userTimezone)}
TIMEZONE: ${userTimezone}
USER: ${userName}

${ragContext}
${PHONE_CONVERSATION_STYLE}`;

    // Add voice-specific extensions if configured
    if (prefs?.realtime_extensions) {
      instructions += `\n\n${prefs.realtime_extensions}`;
    }
    
    // Add scheduling philosophy if configured
    if (prefs?.config?.customAIInstructions) {
      instructions += `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
    }
    
    console.log('[PERSONA] Loaded user instructions from database');
    return instructions;
  } catch (error) {
    console.warn('[PERSONA] Failed to load user instructions:', error);
  }

  // Fallback to default
  return `${DEFAULT_IRIS_PERSONA}

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}
USER: ${userName}
${ragContext}
${PHONE_CONVERSATION_STYLE}`;
}
