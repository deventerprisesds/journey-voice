

# Voicemail Fallback: Use the Same Chat Generation Pipeline as Scheduled Calls

## What's Happening Now

The voicemail detection instruction tells the AI to "deliver the agenda." The AI interprets this literally and passes the raw system prompt as the `message` parameter to `send_chat_message`. The user sees internal instructions instead of a natural check-in.

## What Already Exists

The `send_chat_message` tool has two modes:
- **`message` parameter**: Sends the exact text provided (what's happening now -- raw dump)
- **`context` parameter only (no message)**: Triggers `generateFromContext`, which calls `buildCallContext` to fetch tasks and briefing, then sends it through `hybrid-assistant-api` to generate a natural, conversational check-in

This second path is the **exact same pipeline** used when a scheduled Twilio call is routed to `app_message` mode. Same task fetching, same AI generation, same conversational tone.

## The Fix

Update only the voicemail detection instruction block in `persona.ts` (lines 83-94) to tell the AI to use `context` instead of `message`:

```
VOICEMAIL DETECTION (OUTBOUND CALLS ONLY):
- If you hear a voicemail greeting (e.g., "please leave a message",
  "is not available", carrier beep tones, automated operator voice),
  you are talking to a voicemail system, NOT the user.
- DO NOT leave a voicemail message.
- Instead:
  1. Call send_chat_message with NO message parameter. Use ONLY the
     context parameter with a brief label for the call type
     (e.g., "morning check-in", "evening wrap-up", "recipe sharing").
     This triggers the same natural chat experience as a scheduled
     check-in -- identical to what happens on a regular call.
  2. Call hang_up immediately with no farewell message.
- This ensures the user gets the exact same conversational experience
  via chat that they would have had on the phone.
```

## Why It's Identical

The flow is:

```text
AI detects voicemail
  --> calls send_chat_message(context: "morning check-in")
    --> execute-tool sees no message, sets generateFromContext
      --> send-chat-message edge function
        --> buildCallContext (fetches tasks, briefing, window context)
          --> hybrid-assistant-api (generates natural AI response)
            --> User sees conversational check-in in chat
```

This is the same path as:

```text
Scheduled call with comms_mode: app_message
  --> notification-delivery triggers send-chat-message
    --> buildCallContext (same function)
      --> hybrid-assistant-api (same function)
        --> User sees conversational check-in in chat
```

Same pipeline, same output quality, no redundancy.

## What Changes

| Item | Detail |
|------|--------|
| File modified | `supabase/functions/_shared/persona.ts` |
| Lines changed | 83-94 (the voicemail block from the last diff) |
| Lines removed | 0 (existing code outside this block untouched) |
| New code added | 0 (rewording the same block) |
| Functions to redeploy | `twilio-voice-handler`, `twilio-realtime-bridge`, `conversation-relay-handler` |

