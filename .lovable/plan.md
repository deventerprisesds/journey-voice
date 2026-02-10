

# Sync Cloudflare Bridge: Barge-In, Async Fix, Agenda Wiring, Greeting Guard

## Overview

The Supabase bridge was fixed in the previous message. The Cloudflare bridge has the same bugs plus an additional async/await blocking issue. This plan ports all fixes to the Cloudflare bridge so both modes behave identically.

---

## Problem Summary

| Issue | Supabase Bridge | Cloudflare Bridge |
|-------|----------------|-------------------|
| ElevenLabs barge-in | FIXED (response.cancel + bargeInActive) | BROKEN (line 806: "NO response.cancel") |
| Async TTS blocking | FIXED (fire-and-forget sendElevenLabsTTS) | BROKEN (await handleTextDelta blocks WebSocket loop) |
| Agenda tangent tracking | FIXED (pauseForQuery on interrupt) | Dead code (functions exist, never called) |
| Resume hints after tangent | FIXED (in response.done) | Missing from response.done handler |
| Double greeting guard | FIXED (greetingContextInjected flag) | No guard |
| preferred_greeting naming | FIXED | Already correct (line 1122) |

---

## Changes to `cloudflare/src/TwilioCallSession.ts`

### Fix 1: Async/Await TTS Blocking (Critical - causes silence/delays)

**Line 743**: `await this.handleTextDelta(data)` blocks the WebSocket message handler. While TTS is being fetched from ElevenLabs, no other OpenAI events (including barge-in) can be processed.

**Fix**: Remove `await` -- make it fire-and-forget like the Supabase bridge does at line 510. Add extensive logging around the non-awaited call for debugging visibility.

```text
case 'response.text.delta':
  if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
    // ... first delta logging (keep existing) ...
    this.handleTextDelta(data);  // NO await - fire-and-forget (parity with Supabase line 510)
  }
  break;
```

### Fix 2: ElevenLabs Barge-In (Lines 793-807)

Replace the "clear buffer only, NO response.cancel" block with the full interrupt logic from the Supabase bridge:

1. Clear Twilio audio buffer (already done)
2. Send `response.cancel` to OpenAI to stop text generation
3. Add `private bargeInActive = false` property
4. Set `bargeInActive = true` on interrupt, check in `sendToElevenLabs` to discard late chunks
5. Clear `textBuffer` (sentence buffer)
6. 300ms delayed second Twilio clear + flag reset
7. Call `this.pauseAgendaForTangent(transcript)` (wiring the existing dead code)

Add logging at every step for debugging visibility.

### Fix 3: sendToElevenLabs Barge-In Guard (Line 1248)

Add early exit at top of `sendToElevenLabs`:
```text
if (this.bargeInActive) {
  console.log('[CF] Barge-in active, discarding ElevenLabs TTS chunk');
  return;
}
```

### Fix 4: Agenda Tangent Recovery in response.done (Lines 764-771)

Add agenda recovery logic after the existing cleanup, mirroring the Supabase bridge's response.done handler:

```text
case 'response.done':
  this.isPlaying = false;
  this.isAiSpeaking = false;
  this.currentResponseItemId = null;
  this.audioSamplesPlayed = 0;
  
  // NEW: Agenda tangent recovery (parity with Supabase lines 480-492)
  if (this.agendaPaused && this.bargeInRecoveryPending) {
    const hint = this.getAgendaResumeHint();
    if (hint) {
      console.log(`[CF] AGENDA-RESUME: Injecting hint: ${hint}`);
      // Inject system message to nudge AI back to agenda
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', 
          content: [{ type: 'input_text', 
            text: `[RESUME] ${hint}. Continue with this agenda item naturally. Cover ALL remaining agenda items.` }]
        }
      }));
      // Trigger a response for the resume
      this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
    }
    this.resumeAgenda();  // already defined, never called
    this.bargeInRecoveryPending = false;
  }
  break;
```

New property: `private bargeInRecoveryPending = false;` -- set in the barge-in handler alongside `pauseAgendaForTangent`.

### Fix 5: Double Greeting Guard

Add `private greetingContextInjected = false;` property.

In `triggerPendingGreeting()` (line 1789): Set `this.greetingContextInjected = true` after sending the greeting.

In `sendGreeting()` context injection (lines 1090-1104 and 1142-1156): Add guard `if (!this.greetingContextInjected)` before injecting context, and update the system message to say "SKIP the greeting step (step 1) in the agenda."

### Fix 6: Version Bump

Per the preflight checklist, bump version in three files:
- `cloudflare/src/index.ts` (line 6): `2026-01-29-cf-v7f` to `2026-02-10-cf-v8`
- `cloudflare/src/TwilioCallSession.ts` (line 77): Same
- `.github/workflows/deploy-cloudflare.yml`: Same

### Fix 7: Extensive Debug Logging

Add `console.log` breadcrumbs at every critical point for debugging since the Cloudflare worker is harder to debug than Supabase edge functions:

- `[CF-BARGEIN]` prefix for all barge-in events
- `[CF-AGENDA]` prefix for all agenda state changes  
- `[CF-TTS]` prefix for all ElevenLabs TTS lifecycle (queued, sending, completed, discarded)
- `[CF-GREETING]` prefix for greeting flow with flag states
- Log `bargeInActive`, `bargeInRecoveryPending`, `agendaPaused` state in each handler
- Activity log entries via `logActivityToSupabase` for post-call auditing

---

## New Properties Added

```text
private bargeInActive: boolean = false;
private bargeInRecoveryPending: boolean = false;
private greetingContextInjected: boolean = false;
```

## Files Modified

| File | Changes |
|------|---------|
| `cloudflare/src/TwilioCallSession.ts` | All 7 fixes above |
| `cloudflare/src/index.ts` | Version bump only |
| `.github/workflows/deploy-cloudflare.yml` | Version bump only |
| `cloudflare/PREFLIGHT_CHECKLIST.md` | Add async/await and agenda wiring to Common Mistakes Log |

## Deployment

Cloudflare deploys via GitHub Actions on push to `main` when files under `cloudflare/` change. After Lovable commits these changes, the workflow runs automatically.

## Rollback

Revert the Lovable message to restore all files to their previous state. The next push to `main` will redeploy the previous Cloudflare version.
