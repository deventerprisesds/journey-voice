

# Decentralization Gap Audit & Consolidation Plan

## Executive Summary

After thorough codebase analysis, I've identified **8 major categories** of duplicated configuration across the three communication modes (Supabase Phone, Cloudflare Phone, WebRTC In-App). This violates the "code-reuse-over-duplication" memory principle and creates maintenance headaches.

---

## Gap Analysis

### 1. Timing Constants (HIGH PRIORITY)

| Constant | Supabase Bridge | Cloudflare Bridge | WebRTC App |
|----------|-----------------|-------------------|------------|
| `FAREWELL_DELAY_MS` | 3000ms | 5000ms | 2000ms |
| `SPEECH_DEBOUNCE_MS` | 300ms | 300ms | 300ms |
| `OUTBOUND_HELLO_WAIT_MS` | in config | hardcoded | N/A |

**Current State**: Hardcoded in 3 separate files with inconsistent values
**Source of Truth**: `supabase/functions/_shared/config.ts`

---

### 2. Filler Phrases & Intervals

| Location | Phrases | Intervals |
|----------|---------|-----------|
| `cloudflare/src/TwilioCallSession.ts` | 8 phrases | `[1500, 3500, 6000]` |
| `supabase/functions/twilio-realtime-bridge/index.ts` | SmartFillerManager class | Different structure |
| `src/utils/RealtimeVoiceAssistant.ts` | N/A (relies on OpenAI instructions) | N/A |

**Issue**: Different filler implementations could cause inconsistent UX across phone modes

---

### 3. Sentence Detection Regex

| Location | Pattern |
|----------|---------|
| `cloudflare/src/TwilioCallSession.ts` | `/[.!?]+[\s"')\]]*$/` |
| `supabase/functions/twilio-realtime-bridge/index.ts` | `/[.!?]\s*$/` |

**Issue**: Different regex could cause different sentence boundary detection for ElevenLabs streaming

---

### 4. Default Iris Persona

| Location | Length | Status |
|----------|--------|--------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | ~40 lines | Full persona |
| `supabase/functions/generate-realtime-token/index.ts` | ~15 lines | Abbreviated |
| `cloudflare/src/TwilioCallSession.ts` | Generated dynamically | No hardcoded default |

**Issue**: Persona definition duplicated, could diverge over time

---

### 5. Audio Processing Functions

| Function | Supabase | Cloudflare | WebRTC |
|----------|----------|------------|--------|
| `decodeMulaw` / `encodeMulaw` | ✅ inline | ✅ `audio.ts` | N/A (no μ-law) |
| `upsample8to24` / `downsample24to8` | ✅ inline | ✅ `audio.ts` | N/A |
| `base64ToInt16` / `int16ToBase64` | ✅ inline | ✅ inline | ✅ inline |

**Status**: Cloudflare properly extracted to `audio.ts`, Supabase still inline (duplicate)

---

### 6. Tool Definitions

| Location | Source | Status |
|----------|--------|--------|
| `supabase/functions/execute-tool/index.ts` | Source of truth | ✅ Centralized |
| All other functions | Fetch from `/definitions` endpoint | ✅ Good pattern |
| `cloudflare/src/TwilioCallSession.ts` | Inline copy | ⚠️ Potential drift |

**Issue**: Cloudflare can't fetch from Supabase at runtime, has inline tool definitions

---

### 7. Time-Based Greeting Function

| Location | Implementation |
|----------|----------------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | Full timezone-aware (~20 lines) |
| `cloudflare/src/TwilioCallSession.ts` | Copy of Supabase version |
| `src/utils/RealtimeVoiceAssistant.ts` | Simplified (no timezone) (~5 lines) |

**Issue**: Three implementations, WebRTC one is simpler

---

### 8. ElevenLabs Default Voice ID

| Location | Value |
|----------|-------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | `'EXAVITQu4vr4xnSDxMaL'` |
| `cloudflare/src/TwilioCallSession.ts` | `'EXAVITQu4vr4xnSDxMaL'` |
| `src/utils/RealtimeVoiceAssistant.ts` | N/A (uses settings) |

**Issue**: Magic string duplicated, no centralized default

---

## Proposed Solution Architecture

Since the three runtimes (Deno, Cloudflare Workers, Browser) can't share imports, we use a **"Source of Truth + Documented Copies"** pattern:

```text
┌─────────────────────────────────────────────────────────────────┐
│                   SOURCE OF TRUTH (Deno/Supabase)                │
│                                                                  │
│  supabase/functions/_shared/config.ts                           │
│  ├── VOICE_CONFIG (timing constants)                            │
│  ├── FILLER_CONFIG (phrases, intervals)                         │
│  ├── AUDIO_CONFIG (sample rates, formats)                       │
│  └── DEFAULT_PERSONA (Iris base instructions)                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Cloudflare Copy │ │ Frontend Copy   │ │ Supabase Uses   │
│ constants.ts    │ │ voiceConfig.ts  │ │ Direct Import   │
│ // SYNC WITH... │ │ // SYNC WITH... │ │ from _shared    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Implementation Plan

### Phase 1: Expand Shared Config (Source of Truth)

Update `supabase/functions/_shared/config.ts`:

```typescript
export const VOICE_CONFIG = {
  // Timing
  OUTBOUND_HELLO_WAIT_MS: 2000,
  FAREWELL_DELAY_MS: 5000,
  SPEECH_DEBOUNCE_MS: 300,
  
  // Audio
  SAMPLE_RATE_OPENAI: 24000,
  SAMPLE_RATE_TWILIO: 8000,
  
  // ElevenLabs defaults
  DEFAULT_ELEVENLABS_VOICE_ID: 'EXAVITQu4vr4xnSDxMaL',
  ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
};

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

export const SENTENCE_ENDERS = /[.!?]+[\s"')\]]*$/;
```

### Phase 2: Update Supabase Bridge

- Import from `_shared/config.ts`
- Remove inline duplicates

### Phase 3: Create Frontend Config

Create `src/config/voiceConfig.ts`:
```typescript
// SYNC WITH: supabase/functions/_shared/config.ts
// Last synced: YYYY-MM-DD
export const VOICE_CONFIG = {
  FAREWELL_DELAY_MS: 5000,
  SPEECH_DEBOUNCE_MS: 300,
  // ... other values
};
```

### Phase 4: Create Cloudflare Config

Create `cloudflare/src/config.ts`:
```typescript
// SYNC WITH: supabase/functions/_shared/config.ts
// Last synced: YYYY-MM-DD
export const VOICE_CONFIG = { ... };
export const FILLER_PHRASES = [ ... ];
export const SENTENCE_ENDERS = /[.!?]+[\s"')\]]*$/;
```

### Phase 5: Update Pre-Flight Checklist

Add to `cloudflare/PREFLIGHT_CHECKLIST.md`:

```markdown
### 7. Timing & Voice Constants Synchronization
When changing voice/timing values, sync across:
- [ ] `supabase/functions/_shared/config.ts` (SOURCE OF TRUTH)
- [ ] `cloudflare/src/config.ts` (Cloudflare copy)
- [ ] `src/config/voiceConfig.ts` (Frontend copy)

Sync checklist:
- FAREWELL_DELAY_MS
- SPEECH_DEBOUNCE_MS  
- FILLER_PHRASES
- SENTENCE_ENDERS regex
- DEFAULT_ELEVENLABS_VOICE_ID
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/_shared/config.ts` | MODIFY | Add all voice/timing constants |
| `supabase/functions/twilio-realtime-bridge/index.ts` | MODIFY | Import from shared, remove duplicates |
| `src/config/voiceConfig.ts` | CREATE | Frontend-accessible copy |
| `src/utils/RealtimeVoiceAssistant.ts` | MODIFY | Import from voiceConfig |
| `cloudflare/src/config.ts` | CREATE | Cloudflare-accessible copy |
| `cloudflare/src/TwilioCallSession.ts` | MODIFY | Import from config.ts |
| `cloudflare/PREFLIGHT_CHECKLIST.md` | MODIFY | Add sync documentation |

---

## Expected Outcomes

1. **Single source of truth** for all voice configuration
2. **Explicit sync documentation** prevents silent drift
3. **Pre-flight checklist** catches missed updates
4. **Consistent UX** across all three modes
5. **Easier maintenance** - change in one place, copy to others

---

## Technical Notes

- Version bump to `2026-01-29-cf-v7d` after implementation
- All three locations will use identical values
- Comments in copied files reference source of truth
- Pre-flight checklist enforces human verification

