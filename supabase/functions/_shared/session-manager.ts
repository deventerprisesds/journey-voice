/**
 * Pre-Connect Session Management
 * 
 * Stores and retrieves pre-established sessions in database for persistence
 * across Edge Function instances. Enables instant greetings for scheduled calls.
 */

/**
 * Pre-connect session data structure
 */
export interface PreConnectSession {
  userId: string;
  context: string;
  agenda: Array<{ index: number; text: string; status: string }>;
  timezone: string;
  profile: any;
  greetingText: string;
  audioBase64: string;
  ttsProvider: 'openai' | 'elevenlabs';
  voiceId: string;  // ElevenLabs voice ID
  openaiVoice: string;  // OpenAI voice selection
  phoneCallMode: string;  // User's preferred phone call mode
  createdAt: number;
  // Pre-computed data to skip DB queries during call connect
  ragContext: string;
  instructions: string;
  threadId: string | null;
}

/**
 * Store session in database for cross-instance persistence
 */
export async function storePreConnectSession(
  supabase: any, 
  sessionId: string, 
  session: PreConnectSession
): Promise<void> {
  const { error } = await supabase
    .from('pre_connect_sessions')
    .insert({
      session_id: sessionId,
      user_id: session.userId,
      context: session.context,
      agenda: session.agenda,
      timezone: session.timezone,
      profile: session.profile,
      greeting_text: session.greetingText,
      audio_base64: session.audioBase64,
      tts_provider: session.ttsProvider,
      voice_id: session.voiceId,
      openai_voice: session.openaiVoice,
      phone_call_mode: session.phoneCallMode,
      // Pre-computed data to eliminate DB queries during call connect
      rag_context: session.ragContext,
      instructions: session.instructions,
      thread_id: session.threadId,
      expires_at: new Date(Date.now() + 1800000).toISOString() // 30 min TTL
    });
  
  if (error) {
    console.error('[SESSION-MANAGER] Failed to store session in database:', error);
  } else {
    console.log(`[SESSION-MANAGER] ✅ Session ${sessionId} stored in database`);
  }
}

/**
 * Retrieve session from database (works across Edge Function instances)
 */
export async function getPreConnectSession(
  supabase: any, 
  sessionId: string
): Promise<PreConnectSession | null> {
  const { data, error } = await supabase
    .from('pre_connect_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error || !data) {
    console.log(`[SESSION-MANAGER] Session ${sessionId} not found or expired in database`);
    return null;
  }
  
  // No longer delete on retrieval - session persists for status-callback fallback
  // Cleanup happens via TTL-based cleanupExpiredSessions()
  console.log(`[SESSION-MANAGER] ✅ Retrieved session ${sessionId} from database with ${data.audio_base64?.length || 0} bytes audio`);
  
  return {
    userId: data.user_id,
    context: data.context,
    agenda: data.agenda,
    timezone: data.timezone,
    profile: data.profile,
    greetingText: data.greeting_text,
    audioBase64: data.audio_base64,
    ttsProvider: data.tts_provider,
    voiceId: data.voice_id,
    openaiVoice: data.openai_voice || 'alloy',
    phoneCallMode: data.phone_call_mode || 'media_streams',
    createdAt: new Date(data.created_at).getTime(),
    // Pre-computed data
    ragContext: data.rag_context || '',
    instructions: data.instructions || '',
    threadId: data.thread_id || null
  };
}

/**
 * Clean up expired sessions (can be called periodically)
 */
export async function cleanupExpiredSessions(supabase: any): Promise<number> {
  const { data, error } = await supabase
    .from('pre_connect_sessions')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('session_id');
  
  if (error) {
    console.error('[SESSION-MANAGER] Failed to cleanup expired sessions:', error);
    return 0;
  }
  
  const count = data?.length || 0;
  if (count > 0) {
    console.log(`[SESSION-MANAGER] Cleaned up ${count} expired sessions`);
  }
  return count;
}
