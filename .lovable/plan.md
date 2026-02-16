

# Make Iris Self-Aware: `get_my_config` Introspection Tool

## What the plan already covers (confirmed correct)

The five `section` values in the original plan are solid:

| Section | Source | Data |
|---------|--------|------|
| `scheduled_calls` | `user_scheduling_prefs.scheduled_calls` | All recurring calls: name, time, enabled, context/script, commsMode |
| `call_history` | `call_sessions` | Last 10 calls: started_at, ended_at, duration, direction, call_context |
| `topic_groups` | `task_topic_index` | All topic groups: name, summary, task_count, category_affinity |
| `notification_prefs` | `notification_prefs` | Quiet hours, channel settings, reminder toggles |
| `full_config` | All above + `config`, `core_instructions` | Complete dump |

## What's missing -- 3 additional sections

### 1. `calendar_connections` (new section)
When a user asks "Is my Outlook connected?" or "Which calendars do I have?", Iris has no way to check.

Source: `calendar_connections` (excluding token columns)
Returns: provider, email, is_active, expires_at, connected_services

### 2. `pending_notifications` (new section)
When a user asks "Do I have any reminders coming up?" or "What notifications are queued?", Iris is blind.

Source: `scheduled_notifications` where `delivered_at IS NULL AND failed_at IS NULL`
Returns: title, body, notification_type, scheduled_for (next 10 pending)

### 3. `my_profile` (new section)
When a user asks "What's my phone number on file?" or "What name do you have for me?", Iris has to guess.

Source: `profiles`
Returns: full_name, first_name, email, phone, job_title, company, preferred_greeting

## Final tool definition (8 sections total)

```
section enum: [
  "scheduled_calls",
  "call_history", 
  "topic_groups",
  "notification_prefs",
  "calendar_connections",
  "pending_notifications",
  "my_profile",
  "full_config"
]
```

## Technical details

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/tool-definitions.ts` | Add `get_my_config` tool definition with 8-value enum |
| `supabase/functions/execute-tool/index.ts` | Add `get_my_config` case in switch + `getMyConfig()` handler with sub-queries per section |

### Handler implementation summary

The `getMyConfig` function will:

1. Accept `section` argument
2. Switch on section value
3. Query the appropriate table(s) filtered by `userId`
4. For `full_config`: run all queries and merge results
5. Strip sensitive fields (tokens, internal IDs) before returning
6. Return with `extractedFacts.type = 'other'`

### No other files need changes

- `persona.ts` auto-generates the tool list from `tool-definitions.ts`
- `hybrid-assistant-api` picks up tools via the `/definitions` endpoint
- Voice and phone bridges inherit automatically
- No frontend changes needed

## What this unlocks

After this change, Iris can answer all of these correctly:

- "What is my 6am call about?" -- queries `scheduled_calls`
- "When was my last call?" -- queries `call_history`
- "Is my Outlook connected?" -- queries `calendar_connections`
- "What reminders do I have coming up?" -- queries `pending_notifications`
- "How are my tasks organized?" -- queries `topic_groups`
- "What name do you have for me?" -- queries `my_profile`
- "Tell me everything about my setup" -- queries `full_config`

