
# Phase 1: Add Performative Ring Sound to PhoneDialer

## Summary

When you tap the green call button in the PhoneDialer, a realistic phone ringing sound will play to give the illusion of placing a call. The ring loops during the "dialing" state and stops when the WebRTC voice connection is established and the AI starts speaking.

Additionally, a "Call from my phone" fallback button will be added for when you need car Bluetooth, lock screen controls, etc.

---

## What Changes

### 1. Add Ring Tone Audio File

Create a `public/sounds/` directory and add a phone ring sound:

- **File**: `public/sounds/ring-tone.mp3`
- A standard phone ring sound (~3-4 seconds, looping)
- Can use royalty-free audio from mixkit.co or freesound.org

### 2. Update PhoneDialer Component

**File**: `src/components/CommsConsole/PhoneDialer.tsx`

Changes:
1. Add `useRef` for audio element and initialize on mount
2. Import `connectVoice`, `disconnectVoice`, and `isConnected` from `useCommsConsole`
3. Modify `initiateCall()` to:
   - Play ring sound immediately when tapped
   - Use `connectVoice()` (WebRTC) instead of the slow Twilio REST API callback
   - Stop ring when `isConnected` becomes true
4. Add `useEffect` to watch `isConnected` state and transition from `dialing` → `connected`
5. Update `endCall()` to use `disconnectVoice()`
6. Add "Call from my phone" button that uses `tel:+18665854827` for native dialer

---

## Call Flow

```
User taps green Call button
  ↓
Set state to 'dialing'
  ↓
Play ring-tone.mp3 (looping)
  ↓
Call connectVoice() → WebRTC handshake (~2 seconds)
  ↓
isConnected becomes true
  ↓
Stop ring sound
  ↓
Set state to 'connected'
  ↓
AI speaks
```

---

## Code Changes

### PhoneDialer.tsx - Key Modifications

```typescript
// Add imports
import { useRef, useEffect } from 'react';

// Inside component - get voice connection methods
const { connectVoice, disconnectVoice, isConnected } = useCommsConsole();

// Add audio ref
const ringAudioRef = useRef<HTMLAudioElement | null>(null);

// Initialize ring audio on mount
useEffect(() => {
  ringAudioRef.current = new Audio('/sounds/ring-tone.mp3');
  ringAudioRef.current.loop = true;
  return () => {
    ringAudioRef.current?.pause();
    ringAudioRef.current = null;
  };
}, []);

// Watch connection state to stop ring and update UI
useEffect(() => {
  if (isConnected && callState === 'dialing') {
    ringAudioRef.current?.pause();
    if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
    onCallStateChange('connected');
  }
}, [isConnected, callState, onCallStateChange]);

// Updated initiateCall - uses WebRTC voice
const initiateCall = async () => {
  if (!user?.id) {
    toast({ title: 'Not Signed In', ... });
    return;
  }

  setIsLoading(true);
  onCallStateChange('dialing');
  
  // Start playing ring sound immediately
  try {
    await ringAudioRef.current?.play();
  } catch (e) {
    // Autoplay may be blocked - call still proceeds
    console.log('Ring audio autoplay blocked');
  }

  try {
    await connectVoice(); // Fast WebRTC connection
    // The useEffect above handles stopping ring and updating state
  } catch (err) {
    ringAudioRef.current?.pause();
    onCallStateChange('idle');
    toast({ title: 'Call Failed', ... });
  } finally {
    setIsLoading(false);
  }
};

// Updated endCall - uses disconnectVoice
const endCall = () => {
  ringAudioRef.current?.pause();
  disconnectVoice();
  onCallStateChange('ended');
  // ... rest of existing logic
};

// Add native dialer function
const callFromPhone = () => {
  window.location.href = 'tel:+18665854827';
};
```

### JSX Addition - Below the green call button

```tsx
{/* Call button */}
<Button
  variant="default"
  size="icon"
  className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700 mt-6"
  onClick={initiateCall}
  disabled={isLoading}
>
  <Phone className="h-7 w-7" />
</Button>

{/* Native dialer fallback */}
<button
  onClick={callFromPhone}
  className="text-sm text-muted-foreground mt-4 flex items-center gap-1.5 hover:text-foreground transition-colors"
>
  <Phone className="h-4 w-4" />
  Call from my phone
</button>
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `public/sounds/ring-tone.mp3` | Create | Phone ring sound effect (looping, ~3-4 sec) |
| `src/components/CommsConsole/PhoneDialer.tsx` | Modify | Add ring audio, use WebRTC voice, add native dialer button |

---

## UX Details

- **Ring duration**: Loops until WebRTC connection established (typically ~2 seconds)
- **Volume**: Uses browser/device volume settings
- **Autoplay fallback**: If browser blocks autoplay, call still proceeds silently
- **Native dialer button**: Positioned below main call button, subtle styling
- **End call**: Stops ring audio immediately and disconnects WebRTC voice

---

## Benefits Over Current Implementation

| Aspect | Before | After |
|--------|--------|-------|
| Call latency | 13-16 seconds (Twilio REST API callback) | ~2 seconds (WebRTC) |
| User feedback | Waiting with no audio feedback | Ring sound provides immediate feedback |
| Connection method | Phone rings, user answers | In-app voice starts automatically |
| Bluetooth option | Only option | Secondary "Call from my phone" button |
