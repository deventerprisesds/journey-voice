# Cloudflare Worker Pre-Flight Checklist

## MANDATORY: Check Before Every Deployment

### 1. Version String Synchronization
When changing the worker version, ALL THREE files must be updated:
- [ ] `cloudflare/src/index.ts` (line ~21) - health endpoint version
- [ ] `cloudflare/src/TwilioCallSession.ts` (line ~77) - WORKER_VERSION constant
- [ ] `.github/workflows/deploy-cloudflare.yml` (line ~51) - EXPECTED_VERSION

### 2. State Management Parity
When adding new features, verify Supabase bridge equivalents:
- [ ] All state variables from Supabase exist in Cloudflare
- [ ] State initialization matches Supabase
- [ ] State cleanup in response.done/cleanup matches

### 3. Function Parity
Before claiming feature parity, verify these functions exist:
- [ ] getTimeBasedGreeting() - time-aware greetings
- [ ] loadUserProfile() - user personalization
- [ ] generateGreetingForCallType() - context-based greetings
- [ ] handleBargeIn() uses truncate, not cancel

### 4. Echo Suppression
- [ ] isAiSpeaking flag cleared after TTS completes
- [ ] isSendingTtsAudio flag cleared after audio duration
- [ ] Both flags cleared for direct ElevenLabs greetings

### 5. VAD/Barge-In
- [ ] Uses conversation.item.truncate (NOT response.cancel)
- [ ] Tracks currentResponseItemId
- [ ] Tracks audioSamplesPlayed for truncation point

### 6. Common Mistakes Log

| Date | Mistake | Files Affected | Resolution |
|------|---------|----------------|------------|
| 2026-01-29 | Version mismatch v1 vs v7 | workflow + index.ts + TwilioCallSession.ts | Always update all 3 files |
| 2026-01-29 | Missing loadUserProfile() | TwilioCallSession.ts | Port from Supabase |
| 2026-01-29 | Missing getTimeBasedGreeting() | TwilioCallSession.ts | Port from Supabase |
| 2026-01-29 | Echo flags not cleared after ElevenLabs | TwilioCallSession.ts | Add explicit clearing |
| 2026-01-29 | Used response.cancel instead of truncate | TwilioCallSession.ts | Use conversation.item.truncate |
| 2026-02-10 | `await handleTextDelta` blocked WS loop | TwilioCallSession.ts | Remove await (fire-and-forget like Supabase) |
| 2026-02-10 | ElevenLabs barge-in skipped response.cancel | TwilioCallSession.ts | Add full interrupt: cancel + bargeInActive flag + delayed clear |
| 2026-02-10 | Agenda tangent functions never called | TwilioCallSession.ts | Wire pauseAgendaForTangent + getResumeHint into event handlers |
| 2026-02-10 | No double greeting guard | TwilioCallSession.ts | Add greetingContextInjected flag |
| 2026-03-11 | Version not bumped after model/VAD/logging changes | index.ts + TwilioCallSession.ts + workflow | Always bump version when changing ANY cloudflare/ code |

---

### 7. Timing & Voice Constants Synchronization

When changing voice/timing values, sync across all locations:

| Constant | Source of Truth | Cloudflare Copy | Frontend Copy |
|----------|-----------------|-----------------|---------------|
| `FAREWELL_DELAY_MS` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `SPEECH_DEBOUNCE_MS` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `OUTBOUND_HELLO_WAIT_MS` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `FILLER_CONFIG.PHRASES` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `FILLER_CONFIG.INTERVALS_MS` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `SENTENCE_ENDERS` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |
| `DEFAULT_ELEVENLABS_VOICE_ID` | `supabase/functions/_shared/config.ts` | `cloudflare/src/config.ts` | `src/config/voiceConfig.ts` |

**Sync checklist:**
- [ ] `supabase/functions/_shared/config.ts` (SOURCE OF TRUTH)
- [ ] `cloudflare/src/config.ts` (Cloudflare copy)
- [ ] `src/config/voiceConfig.ts` (Frontend copy)

---

## How to Use This Checklist

1. Before making ANY changes to the Cloudflare bridge, read this document
2. After completing changes, verify all applicable items are checked
3. When a new mistake is discovered, add it to the Common Mistakes Log
4. Review the log before each deployment to avoid repeating past errors
