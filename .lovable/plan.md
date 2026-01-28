

# Fix WebRTC Voice Selection and Add Instance Visibility

## Overview

Two core changes:
1. **Fix ElevenLabs URL** - Export constants from the Supabase client file and import them where needed (proper DRY approach)
2. **Add Instance Visibility** - Global registry to log and track active voice instances

Note: The audio queue persistence issue is deferred until we have instance visibility to confirm if it's actually contributing to problems.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/integrations/supabase/client.ts` | Export `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as named exports |
| `src/utils/RealtimeVoiceAssistant.ts` | Import URL/key from client, add global instance registry with logging |
| `src/components/CommsConsole/PhoneDialer.tsx` | Call `disconnectVoice()` directly for immediate hang-up |

---

## Technical Implementation

### Step 1: Export URL Constants from Client

**File: `src/integrations/supabase/client.ts`**

Change from:
```typescript
const SUPABASE_URL = "https://...";
const SUPABASE_PUBLISHABLE_KEY = "eyJ...";
```

To:
```typescript
export const SUPABASE_URL = "https://...";
export const SUPABASE_PUBLISHABLE_KEY = "eyJ...";
```

Now any file can import these:
```typescript
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
```

---

### Step 2: Fix ElevenLabs TTS Fetch

**File: `src/utils/RealtimeVoiceAssistant.ts`**

Import the constants:
```typescript
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
```

Update `playElevenLabsAudio`:
```typescript
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/elevenlabs-tts`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      text,
      voiceId: this.elevenlabsVoiceId,
      format: 'mp3'
    })
  }
);
```

---

### Step 3: Add Global Instance Registry

**File: `src/utils/RealtimeVoiceAssistant.ts`**

Add at module level:
```typescript
// Global instance tracking for debugging visibility
let globalInstanceCounter = 0;
const activeInstances = new Map<number, RealtimeVoiceAssistant>();

export const getActiveVoiceInstanceCount = () => activeInstances.size;
export const logActiveInstances = () => {
  console.log(`[VOICE_INSTANCES] Active count: ${activeInstances.size}`);
  activeInstances.forEach((instance, id) => {
    console.log(`  - Instance #${id}, sessionId: ${instance.getSessionId()}`);
  });
};
```

Add instance ID property:
```typescript
private instanceId: number = 0;

getSessionId(): string | null {
  return this.sessionId;
}
```

Update constructor:
```typescript
constructor(...) {
  this.instanceId = ++globalInstanceCounter;
  activeInstances.set(this.instanceId, this);
  console.log(`[VOICE_INSTANCE] Created #${this.instanceId}, total active: ${activeInstances.size}`);
  // ... existing code
}
```

Update disconnect:
```typescript
async disconnect() {
  console.log(`[VOICE_INSTANCE] Disconnecting #${this.instanceId}...`);
  activeInstances.delete(this.instanceId);
  console.log(`[VOICE_INSTANCE] Removed #${this.instanceId}, remaining: ${activeInstances.size}`);
  // ... existing cleanup code
}
```

---

### Step 4: Immediate Hang-Up

**File: `src/components/CommsConsole/PhoneDialer.tsx`**

Update `endCall` function:
```typescript
const endCall = () => {
  ringAudioRef.current?.pause();
  if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
  
  // IMMEDIATE disconnect - like a real phone hang-up
  disconnectVoice();
  
  onCallStateChange('ended');
  setIsMuted(false);
  setIsSpeaker(false);
  toast({
    title: 'Call Ended',
    description: `Duration: ${formatDuration(callDuration)}`,
  });

  setTimeout(() => {
    onCallStateChange('idle');
  }, 2000);
};
```

---

## Expected Console Output

When connecting:
```
[VOICE_INSTANCE] Created #1, total active: 1
```

When disconnecting:
```
[VOICE_INSTANCE] Disconnecting #1...
[VOICE_INSTANCE] Removed #1, remaining: 0
```

If multiple instances exist:
```
[VOICE_INSTANCE] Created #2, total active: 2   ← VISIBLE PROBLEM
```

---

## Deferred Items

The audio queue persistence issue will be revisited after instance visibility is implemented. If we observe "total active: 2" scenarios, we can then determine if the queue is contributing to the problem.

