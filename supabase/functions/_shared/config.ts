// =============================================================================
// CENTRALIZED CONFIGURATION FOR ALL EDGE FUNCTIONS
// Update GLOBAL_VERSION here and all functions will use it automatically
// =============================================================================

export const GLOBAL_VERSION = "2026-01-21-v6";

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
