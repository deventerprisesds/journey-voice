

# Cloudflare v7b: Complete Missing Fixes + Pre-Flight Checklist

## Immediate Fix: Version Mismatch

The screenshot shows the deployment failed because:
- **Expected:** `2026-01-29-cf-v1` (hardcoded in workflow line 51)
- **Got:** `2026-01-29-cf-v7` (current code version)

This version must be updated to `2026-01-29-cf-v7b` after we apply the remaining v7b fixes.

---

## Part 1: Pre-Flight Checklist Document

Create a new markdown file that I (and future AI iterations) must reference before making changes to the Cloudflare bridge. This will prevent recurring mistakes.

### File: `cloudflare/PREFLIGHT_CHECKLIST.md`

```text
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
```

---

## Part 2: Remaining v7b Technical Fixes

These fixes were identified in the previous plan but NOT implemented in v7:

### 2a. Add Missing State Variables

```typescript
// Add around line 170 (after userProfile)
private currentResponseItemId: string | null = null;
private audioSamplesPlayed: number = 0;
```

### 2b. Add `response.output_item.added` Handler

Track the response item ID so truncation knows which item to truncate.

### 2c. Track Audio Samples in `response.audio.delta`

Count PCM samples to calculate exact truncation milliseconds.

### 2d. Replace `response.cancel` with `conversation.item.truncate`

Update `handleBargeIn()` to use the proper truncation approach that preserves VAD state.

### 2e. Update `response.done` to Reset State

Clear `currentResponseItemId` and `audioSamplesPlayed` when response completes.

---

## Part 3: Version Synchronization

Update version to `2026-01-29-cf-v7b` in all three files:

1. `cloudflare/src/index.ts` line 21
2. `cloudflare/src/TwilioCallSession.ts` line 77
3. `.github/workflows/deploy-cloudflare.yml` line 51

---

## Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `cloudflare/PREFLIGHT_CHECKLIST.md` | CREATE | New pre-flight checklist document |
| `cloudflare/src/TwilioCallSession.ts` | MODIFY | Add state vars, output_item handler, sample tracking, fix handleBargeIn, fix response.done, version bump |
| `cloudflare/src/index.ts` | MODIFY | Version bump to v7b |
| `.github/workflows/deploy-cloudflare.yml` | MODIFY | Update EXPECTED_VERSION to v7b |

---

## Verification After Deployment

GitHub Actions should show:
```
Health response: {"status":"ok","version":"2026-01-29-cf-v7b",...}
✅ Health check passed!
✅ Version check passed: 2026-01-29-cf-v7b
```

Test call should show:
- `cf_user_speech_stopped` fires (VAD working)
- `cf_transcription` fires (transcription working)
- `messages_persisted: 2+` (conversation recorded)

