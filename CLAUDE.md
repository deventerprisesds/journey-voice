# Journey Voice — Claude Instructions

## Git Workflow

All changes go to the **feature branch first**. Never push directly to `main` unless the user explicitly says "push to production" or "push to main."

**Correct order:**
1. Commit all changes to the designated session feature branch
2. Push the feature branch
3. The user reviews / CI / Lovable preview builds
4. User merges to main when satisfied

**When main has moved ahead of the feature branch**, rebase — do NOT cherry-pick:
```
git fetch origin
git rebase origin/main
git push --force-with-lease origin <feature-branch>
```

**Never** commit to main locally and then try to sync back to the feature branch. One direction only: feature branch → main.

## Project Structure

- `src/contexts/CommsConsoleContext.tsx` — central chat context; handles the Android widget bridge relay
- `src/utils/directLog.ts` — `logToErrorLog()`: fire-and-forget REST write to `error_log`, use for remote diagnostics
- `src/utils/activityLogger.ts` — `logChat()` / `logActivity()`: activity_log writes (dev user only)
- `src/utils/bootTrace.ts` — boot sequence tracing

## Android Bridge Integration (in CommsConsoleContext.tsx)

- `bridgePendingRef` — `useRef(false)`, set to `true` when a `bridgeVoiceResult` event arrives, reset to `false` after `notifyBridgeIfPending` fires
- `notifyBridgeIfPending(text)` — calls `window.AndroidBridge.postAiResponse(text)` if `bridgePendingRef.current` is true; guard prevents double-firing
- Realtime INSERT handler calls `notifyBridgeIfPending` for assistant messages — mirrors the same delivery path the chat UI uses, so the overlay gets notified even if SSE streaming hiccupped

## Diagnostic Logging

Bridge events are logged to `error_log` via `logToErrorLog()`. After a test, query:
```sql
SELECT created_at, error_message, context
FROM error_log
WHERE component = 'Bridge'
ORDER BY created_at DESC LIMIT 20;
```

| error_message | Meaning |
|---|---|
| `bridgeVoiceResult_fired` | JS event reached CommsConsoleContext |
| `notifyBridgeIfPending_called` | Function ran; check `context.pending` |
| `postAiResponse_dispatch` | Check `context.bridgePresent` — if false, AndroidBridge is null in WebView |
