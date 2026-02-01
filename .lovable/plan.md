
# Fix: Phone Dialer Timer Keeps Running After AI-Initiated Disconnect

## Problem Summary

When you say "that's all, goodbye" and the AI triggers the `disconnect` tool to end the call:
1. The AI says its farewell and calls `handleDisconnectTool()` which schedules `disconnect()` after 2 seconds
2. `disconnect()` tears down the WebRTC connection and sets `isConnected = false`
3. **BUG**: The PhoneDialer's `callState` remains `'connected'`, so the timer keeps counting
4. The UI shows the amber "Voice session active" badge but the call duration timer never stops

## Root Cause

The PhoneDialer has an effect that transitions `callState` from `'dialing'` to `'connected'` when `isConnected` becomes true:

```typescript
useEffect(() => {
  if (isConnected && callState === 'dialing') {
    onCallStateChange('connected');
  }
}, [isConnected, callState, onCallStateChange]);
```

**Missing**: There's no corresponding effect to transition `callState` from `'connected'` to `'ended'` when `isConnected` becomes `false`.

## Solution

Add an effect in PhoneDialer.tsx that watches for disconnection during an active call:

### File: `src/components/CommsConsole/PhoneDialer.tsx`

**Add new effect after line 224:**

```typescript
// Watch for disconnection during active call (AI-initiated hang up)
useEffect(() => {
  // If we were in a call (connected state) and the voice session disconnects,
  // transition to 'ended' state - this handles AI-triggered disconnect tool
  if (!isConnected && callState === 'connected') {
    console.log('[PhoneDialer] Voice disconnected during call - transitioning to ended');
    
    // Stop ring audio if somehow still playing
    ringAudioRef.current?.pause();
    if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
    
    onCallStateChange('ended');
    setIsMuted(false);
    setIsSpeaker(false);
    
    toast({
      title: 'Call Ended',
      description: `Duration: ${formatDuration(callDuration)}`,
    });

    // Auto-transition to idle after showing "Call ended" briefly
    setTimeout(() => {
      onCallStateChange('idle');
    }, 2000);
  }
}, [isConnected, callState, onCallStateChange, callDuration, toast]);
```

**Technical Details:**
- The effect watches `isConnected` and `callState`
- When `isConnected` goes from `true` to `false` while `callState === 'connected'`, it means the call was ended programmatically (AI disconnect tool) rather than by user action
- The effect shows a toast with the call duration and transitions to `'ended'` then `'idle'`
- The call timer will stop because the timer effect only runs when `callState === 'connected'`

## Expected Behavior After Fix

1. You say "that's all, goodbye"
2. AI triggers disconnect tool, says farewell
3. WebRTC connection closes, `isConnected` becomes `false`
4. New effect detects this and sets `callState` to `'ended'`
5. Timer stops immediately
6. Toast shows "Call Ended - Duration: X:XX"
7. After 2 seconds, `callState` returns to `'idle'`

## Files to Modify

| File | Change |
|------|--------|
| `src/components/CommsConsole/PhoneDialer.tsx` | Add effect to watch for AI-initiated disconnection and transition call state |

## Testing

After implementing, test by:
1. Start a call via the Phone dialer
2. Say "That's all, goodbye" to trigger the AI disconnect tool
3. Verify the timer stops and shows "Call ended" followed by the idle state
