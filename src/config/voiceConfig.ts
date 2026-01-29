// =============================================================================
// VOICE CONFIGURATION - FRONTEND COPY
// =============================================================================
// SOURCE OF TRUTH: supabase/functions/_shared/config.ts
// Last synced: 2026-01-29
//
// When updating values here, also update:
//   - supabase/functions/_shared/config.ts (source of truth)
//   - cloudflare/src/config.ts (cloudflare worker copy)
// =============================================================================

export const VOICE_CONFIG = {
  // Timing constants
  OUTBOUND_HELLO_WAIT_MS: 2000,       // Max wait for user audio on outbound calls
  FAREWELL_DELAY_MS: 5000,            // Time to wait for farewell audio before disconnect
  SPEECH_DEBOUNCE_MS: 300,            // Debounce rapid speech events
  
  // Audio sample rates
  SAMPLE_RATE_OPENAI: 24000,
  SAMPLE_RATE_TWILIO: 8000,
  
  // ElevenLabs defaults
  DEFAULT_ELEVENLABS_VOICE_ID: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
};

// Filler phrases for tool call acknowledgments (if needed in frontend)
export const FILLER_CONFIG = {
  PHRASES: [
    "One moment...",
    "Let me check...",
    "Checking that...",
    "Just a sec...",
    "Looking into it...",
    "Hmm, let me see...",
    "Working on that...",
    "Almost there...",
  ],
  INTERVALS_MS: [1500, 3500, 6000],
};

// Sentence detection regex for ElevenLabs streaming
export const SENTENCE_ENDERS = /[.!?]+[\s"')\]]*$/;
