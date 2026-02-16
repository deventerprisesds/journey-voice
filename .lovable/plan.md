

# Additive Voicemail Detection -- Persona Update

## Scope

Append a `VOICEMAIL DETECTION` instruction block to the end of the `PHONE_CONVERSATION_STYLE` constant in `supabase/functions/_shared/persona.ts`. This constant is already injected into all three call mode persona builders, so the new instructions automatically apply to every outbound call path (Supabase bridge, Cloudflare, Conversation Relay).

## What Changes

### File: `supabase/functions/_shared/persona.ts`

Add the following block inside the `PHONE_CONVERSATION_STYLE` template literal, after the existing `NEVER:` line (before the closing backtick). No existing text is removed or modified.

```
VOICEMAIL DETECTION (OUTBOUND CALLS ONLY):
- If you hear a voicemail greeting (e.g., "please leave a message",
  "is not available", carrier beep tones, automated operator voice),
  you are talking to a voicemail system, NOT the user.
- DO NOT leave a voicemail message.
- Instead:
  1. Call send_chat_message to deliver the agenda or check-in summary
     you were going to discuss.
  2. Call hang_up immediately with no farewell message.
- This ensures the user still gets the information via chat even
  though they missed the call.
```

## Coverage

| Call Mode | Persona Builder | Covered? |
|-----------|----------------|----------|
| Supabase media_streams bridge | `generateMediaStreamsPersona` (line 268) | Yes |
| Cloudflare Worker bridge | `generateCloudflarePersona` (line 292) | Yes |
| Conversation Relay (Twilio native) | `generateConversationRelayPersona` (line 317) | Yes |

## What Does NOT Change

- All existing persona text stays exactly as-is
- The short-duration heuristic in `twilio-voice-handler` (the safety net from the last diff) stays untouched
- No tool definitions, no database, no frontend changes

## Summary

| Item | Detail |
|------|--------|
| Files modified | 1 (`persona.ts`) |
| Lines removed | 0 |
| Lines added | ~12 |
| Modes affected | All 3 outbound call modes |

