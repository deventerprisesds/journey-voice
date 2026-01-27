
# End Call via AI Hang-Up Tool + Connection Indicator

## Summary

Update the End Call button to trigger the AI's built-in `disconnect` tool (with farewell message) instead of immediately tearing down the connection. Add a visible indicator in Phone mode when the voice session remains connected.

---

## Changes

### 1. Update PhoneDialer End Call Logic

**File**: `src/components/CommsConsole/PhoneDialer.tsx`

Replace the direct `disconnectVoice()` call with a message to the AI requesting it to hang up. This leverages the existing `handleDisconnectTool` in `RealtimeVoiceAssistant.ts` which includes:
- A farewell message toast
- A 2-second delay before actual WebRTC teardown

```typescript
// Current implementation (line 176-195):
const endCall = () => {
  ringAudioRef.current?.pause();
  if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
  disconnectVoice();  // Direct disconnect
  onCallStateChange('ended');
  // ...
};

// New implementation:
const endCall = () => {
  ringAudioRef.current?.pause();
  if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
  
  // Use AI hang-up tool if connected, otherwise direct disconnect
  if (isConnected) {
    sendHangUpMessage();  // New function - sends text to AI
  } else {
    disconnectVoice();
  }
  
  onCallStateChange('ended');
  // ...
};
```

Add a new function to send a hang-up request to the AI:

```typescript
const sendHangUpMessage = () => {
  // Access the voice assistant and send a disconnect command
  // This triggers the AI's disconnect tool which handles farewell
};
```

---

### 2. Expose sendTextMessage in VoiceAssistantContext

**File**: `src/contexts/VoiceAssistantContext.tsx`

Add `sendTextMessage` to the context so PhoneDialer can send the hang-up command:

```typescript
interface VoiceAssistantContextType {
  // ... existing props
  sendTextMessage: (text: string) => void;  // New
}

// In provider:
const sendTextMessage = useCallback((text: string) => {
  assistantRef.current?.sendTextMessage(text);
}, []);
```

---

### 3. Expose sendTextMessage in CommsConsoleContext

**File**: `src/contexts/CommsConsoleContext.tsx`

Pass through the `sendTextMessage` from VoiceAssistantContext:

```typescript
interface CommsConsoleContextValue extends CommsConsoleState {
  // ... existing props
  sendTextMessage: (text: string) => void;  // New
}

// In provider:
const sendTextMessage = useCallback((text: string) => {
  voiceAssistant.sendTextMessage(text);
}, [voiceAssistant]);
```

---

### 4. Add Connection Indicator in Phone Mode

**File**: `src/components/CommsConsole/PhoneDialer.tsx`

Add a persistent visual indicator when the voice session is still connected after a call "ends":

```typescript
// In the Agent Header section (around line 214):
{/* Connection indicator - shows when voice is still connected */}
{isConnected && callState === 'idle' && (
  <div className="mt-2 flex items-center gap-2 text-xs text-amber-500">
    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
    Voice session active
  </div>
)}
```

Also add an indicator during the "ended" state showing disconnect is in progress:

```typescript
{callState === 'ended' && isConnected && (
  <div className="mt-2 text-sm text-muted-foreground">
    Disconnecting...
  </div>
)}
```

---

## Technical Details

### Message Flow

```text
User clicks End Call
        ↓
PhoneDialer sends "Please hang up now"
        ↓
RealtimeVoiceAssistant receives message
        ↓
AI calls disconnect tool
        ↓
handleDisconnectTool() executes:
  - Shows farewell toast
  - Waits 2 seconds
  - Calls this.disconnect()
        ↓
WebRTC teardown, mic released
        ↓
isConnected becomes false
        ↓
Indicator disappears
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/contexts/VoiceAssistantContext.tsx` | Expose `sendTextMessage` function |
| `src/contexts/CommsConsoleContext.tsx` | Pass through `sendTextMessage` |
| `src/components/CommsConsole/PhoneDialer.tsx` | Use AI hang-up, add connection indicator |

---

## Fallback Behavior

If the AI doesn't respond within a reasonable time (the existing 2-second delay in `handleDisconnectTool`), the connection will still be terminated. The indicator ensures users know when the session is still active.
