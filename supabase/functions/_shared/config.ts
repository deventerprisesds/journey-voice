// =============================================================================
// CENTRALIZED CONFIGURATION FOR ALL EDGE FUNCTIONS
// Update GLOBAL_VERSION here and all functions will use it automatically
// =============================================================================

export const GLOBAL_VERSION = "2026-01-25-v16";

// Phone call mode types
export type PhoneCallMode = 'media_streams' | 'conversation_relay' | 'cloudflare';

// Bridge endpoint configuration for switching infrastructure
export const BRIDGE_ENDPOINTS = {
  supabase: 'wss://wwxgajrtmslzklnyplah.supabase.co/functions/v1/twilio-realtime-bridge',
  conversation_relay: 'wss://wwxgajrtmslzklnyplah.supabase.co/functions/v1/conversation-relay-handler',
  // Cloudflare Durable Objects bridge for unlimited call duration
  cloudflare: 'wss://twilio-openai-bridge.purple-bush-495e.workers.dev/call',
} as const;

// Voice greeting behavior configuration
export const VOICE_CONFIG = {
  // Max time to wait for user audio on outbound calls before playing greeting
  OUTBOUND_HELLO_WAIT_MS: 2000,
};

// Twilio ConversationRelay configuration
export const CONVERSATION_RELAY_CONFIG = {
  // STT provider: 'deepgram' or 'google'
  transcriptionProvider: "deepgram",
  // Speech recognition model
  speechModel: "nova-2-general",
  // TTS voice (Google Journey voices are very natural)
  voice: "Google.en-US-Journey-D",
  // Allow user to interrupt the assistant
  interruptible: true,
  // Enable DTMF detection
  dtmfDetection: true,
  // Language for STT
  language: "en-US",
  // Profanity filter
  profanityFilter: true,
  // Welcome greeting (default, can be overridden)
  welcomeGreeting: "Hey! What can I help you with?",
} as const;

// Function-specific identifiers (combine with GLOBAL_VERSION for full version)
export const FUNCTION_IDS = {
  BRIDGE: "twilio-realtime-bridge",
  HANDLER: "twilio-voice-handler",
  DELIVERY: "notification-delivery",
  EXECUTE_TOOL: "execute-tool",
  HYBRID_ASSISTANT: "hybrid-assistant-api",
  AI_TASK_PARSER: "ai-task-parser",
  CALENDAR_INTEGRATION: "calendar-integration-manager",
  CALENDAR_TOKEN: "calendar-token-manager",
  ELEVENLABS_TTS: "elevenlabs-tts",
  GENERATE_REALTIME_TOKEN: "generate-realtime-token",
  PUSH_NOTIFICATION: "send-push-notification",
  UNIFIED_NOTIFICATION: "send-unified-notification",
  WEB_SEARCH: "web-search",
  CONVERSATION_RELAY: "conversation-relay-handler",
} as const;

// Helper to generate full version string
export function getVersion(functionId: string): string {
  return `${GLOBAL_VERSION}-${functionId}`;
}

// Common CORS headers (used by all edge functions)
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Health check response generator
export function createHealthResponse(functionName: string): Response {
  return new Response(
    JSON.stringify({
      name: functionName,
      version: getVersion(functionName),
      globalVersion: GLOBAL_VERSION,
      timestamp: new Date().toISOString(),
      status: "healthy",
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// Standard OPTIONS handler for CORS preflight
export function handleCorsOptions(): Response {
  return new Response(null, { headers: corsHeaders });
}
