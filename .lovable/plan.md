
# Cloudflare Bridge v7: Return to Correct Architecture

## Problem Summary

The Cloudflare bridge was built with shortcuts that diverged from the working Supabase architecture:

1. **Direct ElevenLabs was a workaround**: The `sendToElevenLabs()` direct call bypasses the proper OpenAI response flow, breaking state management (isAiSpeaking never set correctly for greetings)
2. **Missing core functions**: `loadUserProfile()`, `getTimeBasedGreeting()`, `generateGreetingForCallType()` never ported
3. **Hardcoded fallback greeting**: Generic "Hi! This is Iris..." instead of dynamic personalized greeting
4. **Echo suppression flags not cleared**: After direct ElevenLabs greetings, `isAiSpeaking`/`isSendingTtsAudio` stay stale, filtering 87% of user audio

## Root Cause Analysis

The Supabase bridge properly manages greeting flow:

```
Pre-connect Session Path:
1. handlePreConnect() generates greeting with getTimeBasedGreeting() + loadUserProfile()
2. Stores greeting_text, audio_base64, instructions, rag_context in pre_connect_sessions
3. On call connect: playCachedAudio() sends audio AND sets echo suppression flags
4. Flags cleared via setTimeout after estimated audio duration + grace period
5. User audio flows normally to OpenAI VAD

Inbound (No Pre-connect) Path:
1. connectToOpenAI() SLOW PATH loads profile, RAG, TTS prefs in parallel
2. session.configured triggers sendInboundGreeting()
3. sendInboundGreeting() uses getTimeBasedGreeting() + userProfile?.first_name
4. Injects context via OpenAI conversation.item.create + response.create
5. OpenAI generates audio via response.audio.delta (proper state tracking)
```

The Cloudflare bridge breaks this at step 4-5 by calling ElevenLabs directly, bypassing OpenAI's response lifecycle events that manage `isAiSpeaking`.

## Technical Fix

### 1. Port Missing Core Functions (Exact Copy from Supabase)

```typescript
// Add to TwilioCallSession.ts - copy EXACTLY from Supabase lines 122-143
private getTimeBasedGreeting(): string {
  try {
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { 
      timeZone: this.timezone, 
      hour: 'numeric', 
      hour12: false 
    });
    const hour = parseInt(timeStr, 10);
    
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch {
    const hour = new Date().getUTCHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
}

// Add to TwilioCallSession.ts - copy EXACTLY from Supabase lines 192-205
private async loadUserProfile(): Promise<{ first_name?: string; full_name?: string }> {
  if (!this.userId) return {};
  
  try {
    const response = await fetch(
      `${this.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${this.userId}&select=first_name,full_name`,
      {
        headers: {
          'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          'apikey': this.env.SUPABASE_SERVICE_KEY
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      return data?.[0] || {};
    }
  } catch (error) {
    console.warn('[CF] Failed to load user profile:', error);
  }
  return {};
}

// Add to TwilioCallSession.ts - copy EXACTLY from Supabase lines 1063-1077
private generateGreetingForCallType(context: string, timeGreeting: string, userName: string): string {
  if (context.includes('Morning Stand-up')) {
    return `${timeGreeting}, ${userName}. This is your morning check-in.`;
  } else if (context.includes('Midday Check-in')) {
    return `${timeGreeting}, ${userName}. Just checking in on how your day is going.`;
  } else if (context.includes('End of Day Wrap-up')) {
    return `${timeGreeting}, ${userName}. Let's wrap up the day.`;
  } else if (context.includes('Task reminder')) {
    return `${timeGreeting}, ${userName}. Quick reminder about an upcoming task.`;
  }
  return `${timeGreeting}, ${userName}. This is Iris.`;
}
```

### 2. Add User Profile State

```typescript
// Add class property
private userProfile: { first_name?: string; full_name?: string } = {};
```

### 3. Update handleStart to Load Profile

```typescript
// In handleStart() - add to the Promise.all at line 468
await Promise.all([
  this.loadUserVoicePrefs(),
  this.loadUserProfile().then(p => this.userProfile = p),  // ADD THIS
  this.fetchToolDefinitions()
]);
```

### 4. Fix Greeting Generation (line 995)

Replace hardcoded fallback with dynamic generation:

```typescript
// Replace line 995 in sendGreeting()
const timeGreeting = this.getTimeBasedGreeting();
const userName = this.userProfile?.first_name || 'sir';
const callContext = this.ragContext || '';
const greeting = this.greetingText || this.generateGreetingForCallType(callContext, timeGreeting, userName);
```

### 5. Fix Echo Suppression Flag Clearing

The critical bug: `sendToElevenLabs()` sets `isSendingTtsAudio = true` but direct greetings don't go through the proper response lifecycle. 

Add explicit flag clearing after ElevenLabs audio (in sendToElevenLabs around line 1180):

```typescript
// After streaming audio to Twilio, schedule flag clearing
const estimatedDurationMs = (audioBytes.length / 8) * 1000 / 8000; // μ-law: 8 bits @ 8kHz
this.ttsAudioEndTime = Date.now() + estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS;

setTimeout(() => {
  if (this.isSendingTtsAudio && Date.now() >= this.ttsAudioEndTime - 50) {
    this.isSendingTtsAudio = false;
    this.isAiSpeaking = false;  // CRITICAL: Also clear this flag
    console.log('[CF] Echo suppression cleared after ElevenLabs playback');
  }
}, estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS);
```

### 6. Match Supabase Barge-In Logic Exactly (lines 716-728)

Remove the `if (this.isAiSpeaking)` guard that Supabase doesn't have:

```typescript
// ElevenLabs mode: Always clear buffer and break (match Supabase lines 2508-2520)
if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
  console.log('[CF] BARGE-IN: ElevenLabs mode - clearing Twilio buffer only');
  if (this.streamSid && this.twilioWs?.readyState === WebSocket.OPEN) {
    this.twilioWs.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
  }
  this.textBuffer = '';
  this.isAiSpeaking = false;
  break;  // NO response.cancel - preserves OpenAI VAD state
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `cloudflare/src/TwilioCallSession.ts` | Add `getTimeBasedGreeting()`, `loadUserProfile()`, `generateGreetingForCallType()`, `userProfile` state; update `handleStart()` to load profile; fix greeting generation; fix echo flag clearing; align barge-in logic |
| `cloudflare/src/index.ts` | Version bump to `2026-01-29-cf-v7` |

## 8-Area Alignment Checklist

| Area | Supabase | Cloudflare v7 |
|------|----------|---------------|
| 1. Time-Based Greeting | `getTimeBasedGreeting(timezone)` | Add function (copy) |
| 2. User Personalization | `loadUserProfile()` → `first_name` | Add function (copy) |
| 3. Echo Suppression | Flags cleared after audio duration | Fix: clear both flags |
| 4. VAD Speech Detection | Works (87%→0% filtered) | Will work after #3 |
| 5. Barge-In Handling | No `isAiSpeaking` guard | Remove extra guard |
| 6. State Flag Management | `isAiSpeaking = false` after TTS | Add explicit clearing |
| 7. Pre-Connect Session | Stores greeting_text with personalization | Will work after #1,#2 |
| 8. Fallback Greeting | `generateGreetingForCallType()` | Add function (copy) |

## Expected Results After Fix

Test call activity log should show:
```
cf_greeting_success      → "Good morning, Von. This is Iris." (personalized)
cf_user_speech_started   → VAD detected
cf_user_speech_stopped   → VAD completed (NOW FIRES)
cf_transcription         → User speech transcribed (NOW FIRES)
cf_response_started      → AI responding (NOW FIRES)
cf_tts_success           → Response audio delivered
cf_call_summary          → messages_persisted: 2+ (NOT 0)
```
