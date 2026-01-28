

# Fix Plan: Audio Cleanup, Personalization, Transcript Tab, and Call Mode Toggle

## Approved Fixes (1-3)

### Fix 1: Prevent Audio After Disconnect
**File:** `src/utils/RealtimeVoiceAssistant.ts`

Add `isDisconnecting` flag to prevent in-flight ElevenLabs TTS from queuing audio after disconnect:

```typescript
// Add property (around line 303)
private isDisconnecting = false;

// Reset in connect() (around line 480)
this.isDisconnecting = false;

// Set FIRST in disconnect() (line 1264)
async disconnect() {
  this.isDisconnecting = true;  // Block new audio immediately
  // ... existing cleanup
}

// Check in playElevenLabsAudio() (line 1062)
private async playElevenLabsAudio(text: string): Promise<void> {
  if (this.isDisconnecting) return;
  // ... fetch ...
  if (this.isDisconnecting) return;  // Check again after async fetch
  // ... queue audio
}
```

### Fix 2: Return and Use userName for Greeting
**File:** `supabase/functions/generate-realtime-token/index.ts`

Return `userName` in response (line ~490):
```typescript
return new Response(JSON.stringify({
  ...data,
  tts_config: { ... },
  userName: userName,  // ADD THIS
}), { ... });
```

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Store and use userName:
```typescript
private userName: string = 'sir';

// In connect(), after tts_config
if (data.userName) {
  this.userName = data.userName;
}

// In sendGreeting() - use this.userName instead of hardcoded 'sir'
```

### Fix 3: Add Transcript History Tab
**File:** `src/components/CommsConsole/PhoneDialer.tsx`

Add fourth tab "Transcript" with full conversation history:
- Change TabsList to 4 columns
- Add Transcript tab with `MessageSquareText` icon
- ScrollArea showing `voiceTranscripts` from context
- User messages: right-aligned, primary background
- Assistant messages: left-aligned, muted background
- Timestamps below each message
- Empty state when no history

---

## Updated Fix 4: Call Mode Toggle UI

**Current UI:**
- Single green call button (in-app WebRTC)
- Small "Call from my phone" text link below

**New UI - Two Button Layout:**

Replace the single call button area with a side-by-side button group:

```
┌─────────────────────────────────────┐
│           [ Dial Pad ]              │
│                                     │
│     ┌─────────┐   ┌─────────┐       │
│     │  📱    │   │  🔊    │       │
│     │ Phone  │   │ Speaker │       │
│     │(Private)│   │ (Fast) │       │
│     └─────────┘   └─────────┘       │
│                                     │
└─────────────────────────────────────┘
```

**Implementation:**

```tsx
{/* Call mode buttons - replace lines 360-378 */}
<div className="flex flex-col items-center gap-3 mt-6">
  <div className="flex gap-4">
    {/* Phone mode - Twilio via native dialer (earpiece) */}
    <Button
      variant="outline"
      className="flex flex-col items-center gap-1 h-auto py-4 px-6 rounded-2xl border-2 hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
      onClick={callFromPhone}
    >
      <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center">
        <Smartphone className="h-6 w-6 text-white" />
      </div>
      <span className="font-medium">Phone</span>
      <span className="text-xs text-muted-foreground">Private</span>
    </Button>

    {/* Speaker mode - In-app WebRTC */}
    <Button
      variant="outline"
      className="flex flex-col items-center gap-1 h-auto py-4 px-6 rounded-2xl border-2 hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
      onClick={initiateCall}
      disabled={isLoading}
    >
      <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center">
        <Volume2 className="h-6 w-6 text-white" />
      </div>
      <span className="font-medium">Speaker</span>
      <span className="text-xs text-muted-foreground">Fast</span>
    </Button>
  </div>
  
  <p className="text-xs text-muted-foreground text-center max-w-[200px]">
    Phone uses earpiece • Speaker uses loudspeaker
  </p>
</div>
```

**Visual Preview:**

```text
┌────────────────────────────────────────┐
│                                        │
│              ┌─────┐                   │
│              │     │ Dialed digits     │
│              └─────┘                   │
│                                        │
│         ┌───┐  ┌───┐  ┌───┐            │
│         │ 1 │  │ 2 │  │ 3 │            │
│         └───┘  └───┘  └───┘            │
│         ┌───┐  ┌───┐  ┌───┐            │
│         │ 4 │  │ 5 │  │ 6 │            │
│         └───┘  └───┘  └───┘            │
│         ┌───┐  ┌───┐  ┌───┐            │
│         │ 7 │  │ 8 │  │ 9 │            │
│         └───┘  └───┘  └───┘            │
│         ┌───┐  ┌───┐  ┌───┐            │
│         │ * │  │ 0 │  │ # │            │
│         └───┘  └───┘  └───┘            │
│                                        │
│    ┌──────────┐    ┌──────────┐        │
│    │    📱    │    │    🔊    │        │
│    │  Phone   │    │ Speaker  │        │
│    │ Private  │    │   Fast   │        │
│    └──────────┘    └──────────┘        │
│                                        │
│   Phone uses earpiece • Speaker uses   │
│            loudspeaker                 │
│                                        │
├────────────────────────────────────────┤
│ [Keypad] [Transcript] [Recents] [☎️]  │
└────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/RealtimeVoiceAssistant.ts` | Add `isDisconnecting` flag, store/use `userName` |
| `supabase/functions/generate-realtime-token/index.ts` | Return `userName` in response |
| `src/components/CommsConsole/PhoneDialer.tsx` | Add Transcript tab, replace call button with Phone/Speaker buttons |

---

## Testing Checklist

- [ ] Start Speaker call, end mid-response - verify audio stops immediately
- [ ] Start call - verify greeting uses your name (or "sir" fallback)
- [ ] Tap Phone button - verify native dialer opens with Twilio number
- [ ] Tap Speaker button - verify in-app WebRTC call starts
- [ ] Have conversation - verify Transcript tab shows full history

