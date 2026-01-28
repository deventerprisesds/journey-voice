
# Fix: Trigger Greeting When Data Channel Opens (WebRTC Flow)

## Root Cause Analysis

The greeting is never triggered because the WebRTC flow is different from the Twilio WebSocket flow:

| Flow | Session Configuration | `session.updated` Event |
|------|----------------------|-------------------------|
| Twilio (WebSocket) | Sent via `session.update` message after `session.created` | Received after config is applied |
| WebRTC (Token-based) | Pre-configured during ephemeral token generation | Never sent - session is already configured |

The current code waits for `session.updated` which never fires in WebRTC mode.

## Solution

Move the greeting trigger from the `session.updated` event handler to the **data channel `open` event**, with a small delay to ensure the connection is fully established.

## Implementation

### File: `src/utils/RealtimeVoiceAssistant.ts`

**Change 1: Move greeting trigger to data channel open event**

Update lines 567-579 (data channel open handler):

```typescript
this.dc.addEventListener("open", async () => {
  console.log("Data channel opened");
  
  // Log successful connection to activity_log
  await this.logActivity('connected', 'webrtc_ready', {
    metadata: {
      connection_time_ms: Date.now() - this.connectionStartTime,
      tts_provider: this.ttsProvider
    }
  });
  
  this.onConnectionChange(true);
  
  // Trigger greeting after a short delay to ensure connection is stable
  // This replaces the session.updated event which doesn't fire in WebRTC flow
  setTimeout(() => {
    console.log('[GREETING] Data channel ready, triggering greeting');
    this.sendGreeting();
  }, 500);  // 500ms delay for connection stability
});
```

**Change 2: Remove the session.updated case (now unnecessary)**

Remove or comment out lines 744-748:
```typescript
// case 'session.updated':
//   console.log('✅ Session configured, triggering greeting');
//   this.sendGreeting();
//   break;
```

**Change 3: Improve greeting logging for debugging**

Update `sendGreeting()` to add more detailed logging:

```typescript
private sendGreeting(): void {
  if (this.hasGreeted) {
    console.log('[GREETING] Already greeted, skipping');
    return;
  }
  
  if (!this.dc) {
    console.warn('[GREETING] Data channel is null');
    return;
  }
  
  if (this.dc.readyState !== 'open') {
    console.warn(`[GREETING] Data channel not ready: ${this.dc.readyState}`);
    return;
  }
  
  this.hasGreeted = true;
  
  const greeting = this.getTimeBasedGreeting();
  const userName = 'sir';
  
  console.log(`[GREETING] Sending greeting via data channel...`);
  
  // ... rest of implementation
```

## Why This Works

1. **Data channel open = Connection ready**: When the data channel opens, the WebRTC connection is established and ready to receive messages
2. **500ms delay**: Ensures all connection handshakes are complete before sending the greeting
3. **Pre-configured session**: The session is already configured with VAD, tools, and instructions via the ephemeral token - no need to wait for `session.updated`

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/RealtimeVoiceAssistant.ts` | Move greeting trigger to data channel open handler, remove session.updated handler, improve logging |

## Verification

After implementation:
- [ ] Console shows `[GREETING] Data channel ready, triggering greeting`
- [ ] Console shows `[GREETING] Sending greeting via data channel...`
- [ ] AI immediately speaks greeting without waiting for user input
- [ ] Greeting matches time of day (Good morning/afternoon/evening)
