
# Investigation Results: Cloudflare Bridge Missing Pre-Connect Support

## Root Cause Identified

The Cloudflare Durable Objects bridge (`cloudflare/src/TwilioCallSession.ts`) is **incomplete** - it was never updated to support the pre-connected session architecture that the Supabase bridge uses.

## What's Happening

When you switched to `phone_call_mode: cloudflare`, calls route through the Cloudflare Worker instead of the Supabase Edge Function. However:

| Feature | Supabase Bridge | Cloudflare Bridge |
|---------|-----------------|-------------------|
| Reads sessionId from TwiML | ✅ Yes | ❌ No |
| Fetches pre_connect_sessions | ✅ Yes | ❌ No |
| Plays cached ElevenLabs greeting | ✅ Yes | ❌ No |
| Uses personalized instructions | ✅ Yes | ❌ Generic only |
| Has call agenda/context | ✅ Yes | ❌ No |
| Uses RAG context | ✅ Yes | ❌ No |

## Evidence from Logs

The call at 17:30:07 shows:
- Pre-connect session **was created** with `cloudflare` mode
- Session had 33KB of cached audio and personalized greeting
- Session **expired unused** after 2 minutes (Cloudflare never fetched it)
- Call completed (59 seconds) but with generic/broken experience

## Current Cloudflare Behavior

When a call connects, the Cloudflare worker:
1. Ignores the `sessionId` parameter in TwiML
2. Uses a hardcoded greeting: "Hi! This is Iris. How can I help you today?"
3. Uses a minimal 8-line system prompt
4. Has no knowledge of why the call was scheduled

## Fix Required

The Cloudflare worker needs to be updated to:
1. Extract `sessionId` from custom parameters
2. Fetch pre-connect session from Supabase
3. Use the cached audio, instructions, RAG context, and agenda
4. Match feature parity with the Supabase bridge

---

## Technical Changes Needed

### File: `cloudflare/src/TwilioCallSession.ts`

**1. Add sessionId handling in handleStart()** (around line 123):
```typescript
private async handleStart(message: TwilioMessage) {
  // ... existing code ...
  const params = message.start?.customParameters || {};
  this.userId = params.userId || null;
  this.timezone = params.timezone || 'America/New_York';
  const sessionId = params.sessionId || null;  // ADD THIS
  
  // If we have a pre-connected session, fetch it
  if (sessionId) {
    const session = await this.fetchPreConnectSession(sessionId);
    if (session) {
      // Use session data instead of loading fresh
      this.ttsProvider = session.ttsProvider || 'openai';
      this.elevenlabsVoiceId = session.voiceId || this.elevenlabsVoiceId;
      this.openaiVoice = session.openaiVoice || 'alloy';
      this.cachedAudioBase64 = session.audioBase64;
      this.preConnectedInstructions = session.instructions;
      this.greetingText = session.greetingText;
      this.ragContext = session.ragContext;
      // Skip loading prefs fresh - we have everything
      await this.connectToOpenAI();
      return;
    }
  }
  
  // Fallback: Load fresh preferences
  await Promise.all([
    this.loadUserVoicePrefs(),
    this.fetchToolDefinitions()
  ]);
  await this.connectToOpenAI();
}
```

**2. Add fetchPreConnectSession method**:
```typescript
private async fetchPreConnectSession(sessionId: string): Promise<any | null> {
  try {
    const response = await fetch(
      `${this.env.SUPABASE_URL}/rest/v1/pre_connect_sessions?session_id=eq.${sessionId}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          'apikey': this.env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        // Delete after retrieval (one-time use)
        await fetch(
          `${this.env.SUPABASE_URL}/rest/v1/pre_connect_sessions?session_id=eq.${sessionId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
              'apikey': this.env.SUPABASE_SERVICE_KEY
            }
          }
        );
        return data[0];
      }
    }
    return null;
  } catch (error) {
    console.error('[CF] Failed to fetch pre-connect session:', error);
    return null;
  }
}
```

**3. Update buildSystemPrompt() to use pre-connected instructions**:
```typescript
private buildSystemPrompt(): string {
  // If we have pre-connected instructions, use them
  if (this.preConnectedInstructions) {
    return this.preConnectedInstructions;
  }
  
  // Fallback to basic prompt
  const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
  return `You are Iris...`; // existing fallback
}
```

**4. Play cached audio greeting**:
```typescript
private async sendGreeting() {
  // If we have cached ElevenLabs audio, play it immediately
  if (this.cachedAudioBase64 && this.twilioWs && this.streamSid) {
    console.log('[CF] Playing cached greeting audio');
    const audioBytes = Uint8Array.from(atob(this.cachedAudioBase64), c => c.charCodeAt(0));
    const chunkSize = 640;
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      const chunk = audioBytes.slice(i, i + chunkSize);
      this.twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: btoa(String.fromCharCode(...chunk)) }
      }));
    }
    return;
  }
  
  // Fallback: OpenAI generates greeting
  const greeting = this.greetingText || 'Hi! This is Iris. How can I help you today?';
  // ... existing OpenAI greeting code
}
```

---

## Temporary Workaround

Until the Cloudflare worker is fixed, you can switch back to the Supabase bridge:

1. Go to Settings
2. Change `phone_call_mode` from `cloudflare` to `media_streams`
3. Calls will use the working Supabase bridge (with 6-minute limit)

---

## Testing Checklist

After implementing the fix:
- [ ] Scheduled call triggers with personalized greeting voice
- [ ] AI knows the call reason/agenda
- [ ] RAG context is included in conversation
- [ ] ElevenLabs voice is used (not OpenAI voice)
- [ ] Call duration can exceed 6 minutes (Cloudflare benefit)
