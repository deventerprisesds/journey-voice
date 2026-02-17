

# Approved Plan: Deploy + Enforce Tracker + Error-Path Push

## Scope (confirmed)

| Item | Included |
|------|----------|
| Create `.lovable/rules.md` | YES |
| Overhaul `docs/DEBUG_TRACKER.md` | YES |
| Add push notification to error path in `useChatAssistant.ts` | YES |
| Deploy 5 pending edge functions | YES |
| Run `sync-assistant-tools` | YES |
| Fix midday check-in context in database | NO (deferred) |

## Steps

### 1. Create `.lovable/rules.md`
Mandatory instructions the AI reads at the start of every session:
- Read `docs/DEBUG_TRACKER.md` before any changes
- Update it after any changes (change log, issues, lessons)
- Never deploy without updating tracker first

### 2. Overhaul `docs/DEBUG_TRACKER.md`
- Add Pre-Flight Checklist (edge functions, scheduled calls, chat/push, database)
- Backfill Change Log with all 12 Feb 17 entries (marked "NOT DEPLOYED")
- Update Active Issues (CHAT-01 through CHAT-04, PUSH-01, DEPLOY-01)
- Add Lessons Learned (9-15)
- Add Known Configuration section (scheduled calls table, cron jobs)

### 3. Add push notification to error path in `useChatAssistant.ts`
- Extract push logic into a reusable helper
- Call it from the success path (existing, ~line 640)
- Call it from the error catch block (~line 689) so users get notified even when the request fails
- Add activity logging for push decisions (visibility state, sent/skipped)

### 4. Deploy 5 edge functions
- `execute-tool`
- `send-chat-message`
- `hybrid-assistant-api`
- `generate-realtime-token`
- `twilio-voice-handler`

### 5. Run `sync-assistant-tools`
Propagate persona and tool description changes to OpenAI Assistant.

### 6. Update tracker
Mark deployed functions in Change Log as "DEPLOYED" with date.

