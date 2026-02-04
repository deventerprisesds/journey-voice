
# Fix: AI Choosing Slack Instead of In-App Chat for Messages

## Problem Identified

When you ask the AI "send me a message about xyz", it routes to Slack instead of the in-app chat. This is a **tool description ambiguity issue** in the OpenAI assistant.

### Root Cause

The tool descriptions in `execute-tool/index.ts` create confusion:

| Tool | Current Description | Problem |
|------|---------------------|---------|
| `send_slack_message` | "Send a Slack message to the user." | Generic - sounds like the default |
| `send_chat_message` | "Send a chat message to the user. Use for 'remind me in X minutes'..." | Focuses on scheduling, not general messaging |

When you say "send me a message about X", the AI sees `send_slack_message` as the simpler match because `send_chat_message` emphasizes delayed/scheduled messages.

---

## Solution

Update the tool descriptions to make `send_chat_message` the **primary in-app messaging tool** and `send_slack_message` the **explicit Slack integration tool**:

### Updated Descriptions

**`send_chat_message`** (PRIMARY for in-app messages):
```
"Send a message to the user via the app's chat interface. This is the PRIMARY way to message the user.
Use for: immediate messages, reminders ('remind me in X minutes'), scheduled check-ins ('send me a message at 3pm'),
or any request to 'message me', 'text me', 'send me something', or 'notify me'. Prefer this over Slack unless
the user explicitly says 'send to Slack' or 'Slack message'."
```

**`send_slack_message`** (ONLY for explicit Slack requests):
```
"Send a message via Slack integration. ONLY use this when the user EXPLICITLY requests Slack
(e.g., 'send me a Slack message', 'post to Slack', 'message me on Slack'). For general
'send me a message' requests, use send_chat_message instead."
```

---

## Implementation Details

### File: `supabase/functions/execute-tool/index.ts`

**Change 1: Update `send_slack_message` description (lines 181-191)**

From:
```typescript
{
  type: "function",
  name: "send_slack_message",
  description: "Send a Slack message to the user.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to send" }
    },
    required: ["message"]
  }
}
```

To:
```typescript
{
  type: "function",
  name: "send_slack_message",
  description: "Send a message via Slack integration. ONLY use when user EXPLICITLY requests Slack (e.g., 'send me a Slack message', 'post to Slack', 'message me on Slack'). For general 'send me a message' requests, use send_chat_message instead.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to send" }
    },
    required: ["message"]
  }
}
```

**Change 2: Update `send_chat_message` description (lines 254-279)**

From:
```typescript
{
  type: "function",
  name: "send_chat_message",
  description: "Send a chat message to the user. Use for 'remind me in X minutes', 'send me a message at 3pm', 'check in with me later', or any deferred messaging request.",
  parameters: { ... }
}
```

To:
```typescript
{
  type: "function",
  name: "send_chat_message",
  description: "Send a message to the user via the app's chat interface. This is the PRIMARY and DEFAULT way to message the user. Use for: immediate messages, reminders ('remind me in X minutes'), scheduled check-ins ('message me at 3pm'), or ANY request like 'message me', 'send me something', 'text me', 'notify me about X'. Prefer this over Slack/Email unless user explicitly requests those channels.",
  parameters: { ... }
}
```

---

## Why This Works

1. **"PRIMARY and DEFAULT"** - Makes it clear to the AI that this is the preferred tool
2. **Broader trigger phrases** - Covers "message me", "send me something", "text me", "notify me"
3. **Explicit routing** - `send_slack_message` now says "ONLY use when user EXPLICITLY requests Slack"
4. **Immediate + delayed** - Covers both use cases in one tool

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/execute-tool/index.ts` | Update descriptions for `send_slack_message` and `send_chat_message` |

---

## Expected Behavior After Fix

| User Says | AI Chooses |
|-----------|------------|
| "Send me a message about the meeting" | `send_chat_message` |
| "Message me in 5 minutes" | `send_chat_message` |
| "Remind me at 3pm" | `send_chat_message` |
| "Text me about this" | `send_chat_message` |
| "Send me a **Slack** message" | `send_slack_message` |
| "Post this to **Slack**" | `send_slack_message` |

---

## Testing

After deployment:
1. Ask the AI: "Send me a message about my tasks"
2. Verify `send_chat_message` is called (check activity_log for `chat_send` events)
3. Ask the AI: "Send me a Slack message about my tasks"
4. Verify `send_slack_message` is called
