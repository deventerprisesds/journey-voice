
# Two Fixes: Shared Action Confirmation + Voicemail Duration Bug

## Fix 1: Action Confirmation Guardrail (All Modes)

### The Problem
The confirmation rule was only going to be added to `hybrid-assistant-api` (chat). But per the "fix once, apply everywhere" principle, this needs to apply to phone calls and in-app voice too.

### The Solution
Add the confirmation rule to **`_shared/persona.ts`** in the `getDefaultIrisPersona()` function, right after the existing TOOL USAGE section. This is the shared persona consumed by all three modes (phone, voice, chat), so the rule propagates everywhere automatically.

**New block added to `persona.ts` (after TOOL USAGE section, before "Available functions"):**

```
ACTION CONFIRMATION (CRITICAL):
- Before making ANY destructive or state-changing action (marking tasks done,
  rescheduling, moving to backlog, deleting, creating), tell the user what
  you plan to do and WAIT for their confirmation.
- Do NOT execute the tool until the user says yes/confirms.
- Example: "I'll mark 'Transfer $40k' as done and move the duplicate to
  backlog -- sound right?"
- Exception: Read-only actions (get_tasks, web_search, get_today_tasks)
  do not need confirmation.
```

Also **remove** the chat-only version from `hybrid-assistant-api/index.ts` DATA INTEGRITY RULES to avoid duplication, since the shared persona now covers it.

### Files Changed
| File | Change |
|------|--------|
| `_shared/persona.ts` | Add ACTION CONFIRMATION block to shared persona |
| `hybrid-assistant-api/index.ts` | Remove duplicate (DATA INTEGRITY RULES stays, just no confirmation rule there) |

---

## Fix 2: Voicemail Fallback for Ultra-Short Calls

### The Problem
The current code at line 1487 requires `callDuration > 0`:
```
callDuration > 0 && callDuration < 45
```

When you decline a call in under 5 seconds, Twilio often reports `callDuration = 0` with `callStatus = 'completed'`. The `> 0` check filters these out, so the fallback never triggers. The logs confirm only the 35-second call produced a status-callback detection -- the shorter call was silently ignored.

### The Fix
**File: `supabase/functions/twilio-voice-handler/index.ts` (line 1487)**

Change:
```
callDuration > 0 && callDuration < 45
```
To:
```
callDuration < 10
```

This removes the `> 0` floor so that 0-second declined calls are caught, and lowers the ceiling to 10 seconds so that legitimate short conversations (like the 35-second one you had) are not falsely treated as voicemail.

A 0-second `completed` call with a pre-connect session is almost certainly a decline-to-voicemail. The pre-connect session check (lines 1491-1499) still acts as the safety gate -- only scheduled calls trigger fallback, not random short calls.

### Files Changed
| File | Change |
|------|--------|
| `twilio-voice-handler/index.ts` | Line 1487: remove `> 0`, change `< 45` to `< 10` |

---

## Deployment

1. Deploy `twilio-voice-handler` (duration fix)
2. Deploy `twilio-realtime-bridge` (picks up persona change via shared module)
3. Run `sync-assistant-tools` (syncs updated persona to OpenAI Assistant for chat)
4. Deploy `hybrid-assistant-api` (remove duplicate confirmation rule)

## Validation

- Decline a scheduled call instantly -- should trigger chat fallback
- Ask the chat assistant to "mark X as done" -- should ask for confirmation first
- On a phone call, ask to reschedule something -- should confirm before executing
