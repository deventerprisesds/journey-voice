/**
 * Call Session Tracking Utilities
 * 
 * Handles call session creation, updates, and message logging
 * for persistent call analytics and conversation history.
 */

import { GLOBAL_VERSION, FUNCTION_IDS } from "./config.ts";

const BRIDGE_VERSION = `${GLOBAL_VERSION}-${FUNCTION_IDS.BRIDGE}`;

/**
 * Error logging helper - persists errors to error_log for unified debugging
 */
export async function logError(
  supabase: any,
  errorType: string,
  errorMessage: string,
  context: Record<string, any> = {}
): Promise<void> {
  try {
    await supabase.from('error_log').insert({
      source: 'edge_function',
      component: 'twilio-realtime-bridge',
      session_id: context.sessionId || null,
      user_id: context.userId || null,
      error_type: errorType,
      error_message: errorMessage,
      context: {
        version: BRIDGE_VERSION,
        stage: context.stage,
        stack: context.stack,
        ...context
      }
    });
    console.log(`[ERROR_LOG] ✅ ${errorType}: ${errorMessage.substring(0, 50)}...`);
  } catch (e) {
    console.error('[ERROR_LOG] Failed to persist error:', e, { errorType, errorMessage });
  }
}

/**
 * Create a new call session record
 */
export async function createCallSession(
  supabase: any,
  params: {
    userId: string | null;
    callSid: string;
    streamSid: string | null;
    callDirection: string;
    fromNumber: string | null;
    toNumber: string | null;
    callContext: string | null;
    ttsProvider: string;
  }
): Promise<string | null> {
  const { userId, callSid, streamSid, callDirection, fromNumber, toNumber, callContext, ttsProvider } = params;
  
  if (!userId) return null;

  try {
    // Activity log entry
    await supabase.from('activity_log').insert({
      user_id: userId,
      activity_type: `phone_${callDirection}`,
      status: 'active',
      session_id: streamSid || callSid,
      started_at: new Date().toISOString()
    });
    console.log(`[ACTIVITY_LOG] ✅ phone_${callDirection} started (${streamSid || callSid})`);
    
    const { data, error } = await supabase.from('call_sessions').insert({
      user_id: userId,
      call_sid: callSid,
      stream_sid: streamSid,
      direction: callDirection,
      from_number: fromNumber || null,
      to_number: toNumber || null,
      call_context: callContext,
      tts_provider: ttsProvider,
      started_at: new Date().toISOString()
    }).select('id').single();
    
    if (data) {
      console.log(`[CALL-TRACK] ✅ Created call session: ${data.id}`);
      return data.id;
    } else if (error) {
      console.warn('[CALL-TRACK] Failed to create call session:', error);
    }
  } catch (error) {
    console.warn('[CALL-TRACK] Error creating call session:', error);
  }
  
  return null;
}

/**
 * Close an active call session
 */
export async function closeCallSession(
  supabase: any,
  params: {
    callSessionId: string | null;
    streamSid: string | null;
    userId: string | null;
    callDirection: string;
    callStartTime: number;
    messageIndex: number;
    greetingLatencyMs: number | null;
    firstAudioTime: number | null;
    ttsProvider: string;
    responseCreateCount: number;
    twilioMediaFramesIn: number;
    twilioMediaFramesOut: number;
  }
): Promise<void> {
  const { 
    callSessionId, streamSid, userId, callDirection, callStartTime, 
    messageIndex, greetingLatencyMs, firstAudioTime, ttsProvider,
    responseCreateCount, twilioMediaFramesIn, twilioMediaFramesOut 
  } = params;
  
  if (!callSessionId) return;
  
  try {
    const durationSeconds = Math.floor((Date.now() - callStartTime) / 1000);
    
    if (streamSid && userId) {
      await supabase.from('activity_log').update({
        status: 'completed',
        duration_seconds: durationSeconds,
        message_count: messageIndex,
        ended_at: new Date().toISOString(),
        metadata: {
          greeting_latency_ms: greetingLatencyMs,
          tts_provider: ttsProvider,
          response_create_count: responseCreateCount,
          audio_frames_in: twilioMediaFramesIn,
          audio_frames_out: twilioMediaFramesOut
        }
      }).eq('session_id', streamSid);
      console.log(`[ACTIVITY_LOG] ✅ phone_${callDirection} completed (${durationSeconds}s)`);
    }
    
    await supabase.from('call_sessions').update({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      first_audio_at: firstAudioTime ? new Date(firstAudioTime).toISOString() : null,
      greeting_latency_ms: greetingLatencyMs
    }).eq('id', callSessionId);
    console.log(`[CALL-TRACK] ✅ Closed call session: ${durationSeconds}s duration`);
  } catch (error) {
    console.warn('[CALL-TRACK] Error closing call session:', error);
  }
}

/**
 * Save a call message to both call_messages and conversation_messages tables
 */
export async function saveCallMessage(
  supabase: any,
  params: {
    callSessionId: string | null;
    userId: string | null;
    threadId: string | null;
    streamSid: string | null;
    role: string;
    content: string;
    messageIndex: number;
    latencyMs?: number;
    toolInfo?: { name: string; input?: any; output?: any };
  }
): Promise<number> {
  const { callSessionId, userId, threadId, streamSid, role, content, messageIndex, latencyMs, toolInfo } = params;
  
  if (!userId || !content) return messageIndex;
  
  const newMessageIndex = messageIndex + 1;
  const startTime = new Date().toISOString();
  
  try {
    if (callSessionId) {
      await supabase.from('call_messages').insert({
        call_session_id: callSessionId,
        user_id: userId,
        role: role,
        content: content,
        message_index: newMessageIndex,
        started_at: startTime,
        latency_ms: latencyMs,
        tool_name: toolInfo?.name || null,
        tool_input: toolInfo?.input || null,
        tool_output: toolInfo?.output || null,
        word_count: content.split(/\s+/).length
      });
    }
    
    if (threadId && role !== 'tool') {
      await supabase.from('conversation_messages').insert({
        user_id: userId,
        thread_id: threadId,
        role: role,
        content: content,
        source: 'phone',
        voice_session_id: streamSid,
        audio_transcript: content,
        metadata: { latency_ms: latencyMs, call_session_id: callSessionId }
      });
    }
    
    console.log(`[CALL-TRACK] 💬 ${role.toUpperCase()} [#${newMessageIndex}] ${latencyMs ? `(${latencyMs}ms)` : ''}`);
  } catch (error) {
    console.warn('[CALL-TRACK] Failed to save message:', error);
  }
  
  return newMessageIndex;
}

/**
 * Smart Filler Manager - inserts natural fillers during long tool calls
 */
export class SmartFillerManager {
  private toolStartTime = 0;
  private fillerTimeouts: number[] = [];
  private sendFiller: (text: string) => void;
  private lastFillerUsed: string = '';

  private readonly FILLERS = {
    short: ["One moment.", "Let me check.", "Checking.", "One sec."],
    medium: ["Still looking...", "Almost there...", "Bear with me..."],
    long: ["This is taking a moment...", "Still working on it...", "Just a bit longer..."]
  };

  private readonly DELAYS = {
    short: 1500,
    medium: 3500,
    long: 6000
  };

  constructor(sendFiller: (text: string) => void) {
    this.sendFiller = sendFiller;
  }

  startTool(toolName: string) {
    this.toolStartTime = Date.now();
    console.log(`[FILLER] Starting timer for tool: ${toolName}`);

    this.fillerTimeouts.push(
      setTimeout(() => this.insertFiller('short'), this.DELAYS.short) as unknown as number,
      setTimeout(() => this.insertFiller('medium'), this.DELAYS.medium) as unknown as number,
      setTimeout(() => this.insertFiller('long'), this.DELAYS.long) as unknown as number
    );
  }

  endTool() {
    this.fillerTimeouts.forEach(clearTimeout);
    this.fillerTimeouts = [];
    const elapsed = Date.now() - this.toolStartTime;
    console.log(`[FILLER] Tool completed in ${elapsed}ms`);
  }

  private insertFiller(tier: 'short' | 'medium' | 'long') {
    const phrases = this.FILLERS[tier];
    let phrase = phrases[Math.floor(Math.random() * phrases.length)];
    while (phrase === this.lastFillerUsed && phrases.length > 1) {
      phrase = phrases[Math.floor(Math.random() * phrases.length)];
    }
    this.lastFillerUsed = phrase;
    console.log(`[FILLER] Inserting ${tier} filler: "${phrase}"`);
    this.sendFiller(phrase);
  }
}

/**
 * Validate AI voice responses against tool output facts
 */
export function validateVoiceResponse(
  aiResponse: string, 
  toolOutput: { toolName: string; extractedFacts?: any }
): { valid: boolean; correction?: string } {
  if (!toolOutput.extractedFacts) return { valid: true };
  
  const facts = toolOutput.extractedFacts;
  
  if (facts.type === 'task_list' || facts.type === 'today_tasks') {
    const actualCount = facts.count ?? 0;
    
    const countPatterns = [
      /you have (\d+) tasks?/i,
      /(\d+) tasks? (?:for|scheduled|today)/i,
      /found (\d+) tasks?/i,
      /there (?:are|is) (\d+) tasks?/i,
      /(\d+) scheduled/i,
      /have (\d+) things?/i
    ];
    
    for (const pattern of countPatterns) {
      const match = aiResponse.match(pattern);
      if (match) {
        const claimedCount = parseInt(match[1]);
        if (claimedCount !== actualCount) {
          console.log(`[BRIDGE-VALIDATE] Discrepancy: AI claimed ${claimedCount}, tool returned ${actualCount}`);
          return {
            valid: false,
            correction: `You have ${actualCount} task${actualCount !== 1 ? 's' : ''}, not ${claimedCount}.`
          };
        }
      }
    }
  }
  
  return { valid: true };
}
