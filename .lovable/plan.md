

# Add Missing Calendar Tools to WebRTC Voice

## Problem

The `generate-realtime-token` edge function is missing two specific calendar tools that exist in both `execute-tool` and the Twilio bridge:

- `create_outlook_event` - Create events directly in Outlook
- `create_google_event` - Create events directly in Google Calendar

The WebRTC voice assistant only has `create_calendar_event` (which requires the user to specify "outlook" or "google"), but users saying "add this to my Outlook calendar" won't trigger the right tool.

## Current State

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        execute-tool (central)                       │
├─────────────────────────────────────────────────────────────────────┤
│ create_outlook_event  │ create_google_event  │ create_calendar_event │
└──────────┬────────────┴──────────┬───────────┴──────────┬───────────┘
           │                       │                      │
    ┌──────┴──────┐         ┌──────┴──────┐        ┌──────┴──────┐
    │ Twilio Phone │         │   WebRTC    │        │   Chat API  │
    │     ✅       │         │     ❌      │        │     ✅      │
    └─────────────┘         └─────────────┘        └─────────────┘
```

## Solution

Add the two missing tool definitions to `generate-realtime-token/index.ts`:

**File: `supabase/functions/generate-realtime-token/index.ts`**

Add these tools after `create_calendar_event` (around line 392):

```typescript
{
  type: "function",
  name: "create_outlook_event",
  description: "Create an Outlook calendar event.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title" },
      start_time: { type: "string", description: "Start time in ISO format" },
      end_time: { type: "string", description: "End time in ISO format" },
      duration: { type: "number", description: "Duration in minutes (if no end_time)" },
      description: { type: "string", description: "Event description" },
      reminder: { type: "string", description: "Reminder minutes before" }
    },
    required: ["title", "start_time"]
  }
},
{
  type: "function",
  name: "create_google_event",
  description: "Create a Google Calendar event.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title" },
      start_time: { type: "string", description: "Start time in ISO format" },
      end_time: { type: "string", description: "End time in ISO format" },
      duration: { type: "number", description: "Duration in minutes (if no end_time)" },
      description: { type: "string", description: "Event description" },
      reminder: { type: "string", description: "Reminder minutes before" }
    },
    required: ["title", "start_time"]
  }
}
```

## Technical Details

No changes needed to `RealtimeVoiceAssistant.ts` - it already routes all tools (except `disconnect`) through `execute-tool`, which already handles both `create_outlook_event` and `create_google_event`.

The only change is adding the tool definitions so OpenAI knows these tools exist during WebRTC sessions.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-realtime-token/index.ts` | Add `create_outlook_event` and `create_google_event` tool definitions |

## Expected Outcome

After this fix:
- WebRTC voice users can say "Add a meeting to my Outlook calendar" → triggers `create_outlook_event`
- WebRTC voice users can say "Put this on my Google calendar" → triggers `create_google_event`
- Full feature parity with Twilio phone for calendar operations

