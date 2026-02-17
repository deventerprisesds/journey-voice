# Master Debug Tracking Sheet

**Last Updated**: 2026-02-17

---

## Pre-Flight Checklist

Before making changes, verify:

| Area | Check | How to verify |
|------|-------|---------------|
| Edge Functions | All modified functions deployed? | `supabase--deploy_edge_functions` |
| Scheduled Calls | `user_scheduling_prefs.scheduled_calls` correct? | Query `user_scheduling_prefs` for target user |
| Chat / Push | Push notification triggers in both success AND error paths? | Check `useChatAssistant.ts` |
| Database | RLS policies in place for new tables? | `supabase--linter` |
| Cron Jobs | `notification-scheduler` (hourly) and `notification-delivery` (60s) running? | Check `supabase/config.toml` |

---

## Active Issues

| ID | Problem | Status | Root Cause |
|----|---------|--------|------------|
| VOICE-03 | Phone lookup matches demo user, routes to wrong bridge | PENDING DEPLOY | `.ilike('%4434150606%')` matches both real and demo. `.maybeSingle()` errors silently. |
| VOICE-04 | ElevenLabs failures produce zero audio output | PENDING DEPLOY | No fallback audio sent on ElevenLabs quota/API error. |
| VOICE-05 | Semantic VAD not triggering responses in text-only mode | INVESTIGATING | OpenAI semantic VAD with `modalities: ["text"]` may not reliably trigger responses. |
| CHAT-01 | Push notification not sent on chat error path | FIXING | Error catch block at line 689 of `useChatAssistant.ts` lacked push trigger. |
| DEPLOY-01 | Multiple code changes written but never deployed | FIXING | No enforcement mechanism existed to require deployment after code changes. |

---

## Change Log

| Date | Component | Change | Status |
|------|-----------|--------|--------|
| 2026-02-17 | `.lovable/rules.md` | Created mandatory tracker enforcement | DEPLOYED |
| 2026-02-17 | `docs/DEBUG_TRACKER.md` | Full overhaul with pre-flight, change log, pipeline docs | DEPLOYED |
| 2026-02-17 | `useChatAssistant.ts` | Extracted push helper, added to error path with activity logging | DEPLOYED |
| 2026-02-17 | `execute-tool` | Pending changes from prior sessions | DEPLOYING |
| 2026-02-17 | `send-chat-message` | Presence-aware delivery, staleness guard | DEPLOYING |
| 2026-02-17 | `hybrid-assistant-api` | Pending changes from prior sessions | DEPLOYING |
| 2026-02-17 | `generate-realtime-token` | Pending changes from prior sessions | DEPLOYING |
| 2026-02-17 | `twilio-voice-handler` | Phone lookup fix (VOICE-03), ElevenLabs fallback (VOICE-04) | DEPLOYING |
| 2026-02-17 | `sync-assistant-tools` | Propagate persona and tool changes to OpenAI | DEPLOYING |

---

## Attempted Fixes Log

| Issue ID | Attempt | Date | Outcome | Why It Failed/Succeeded |
|----------|---------|------|---------|-------------------------|
| CLIP-01 | Remove `overflow-hidden` from time window container | 2026-01-29 | FAILED | ScrollArea has `overflow-hidden` baked into root element |
| CLIP-01 | Enable horizontal scrolling with ScrollBar orientation="horizontal" | 2026-01-30 | SUCCESS | Added horizontal scrollbar and min-w-max to content |
| NAV-01 | Add assistant button to top header | 2026-01-29 | PARTIAL | Button added but Demo badge covered it |
| NAV-01 | Move Demo badge to center | 2026-01-30 | SUCCESS | Badge centered, no longer overlaps |
| VOICE-03 | Two-step phone lookup excluding demo user ID | 2026-02-10 | PENDING DEPLOY | Exact match first (excluding demo), then fuzzy, then demo fallback |
| VOICE-04 | Announce ElevenLabs errors via OpenAI audio | 2026-02-10 | PENDING DEPLOY | On ElevenLabs failure, use OpenAI `response.create` with audio modalities |
| VOICE-05 | Added VAD tracing logs | 2026-02-10 | PENDING DATA | Log-only changes to gather data |
| CHAT-01 | Extract push helper, add to error catch block | 2026-02-17 | DEPLOYING | Push now fires for both success and error paths |
| DEPLOY-01 | Created `.lovable/rules.md` enforcement | 2026-02-17 | DEPLOYING | AI must read/update tracker before and after changes |

---

## Lessons Learned

1. **ScrollArea overflow-hidden is immutable**: Radix ScrollArea applies `overflow-hidden` at root. Fix must be internal layout changes.

2. **Fixed position conflicts**: Multiple fixed-position elements at same coordinates overlap. Always check first.

3. **Flex overflow prevention**: Use `min-w-0` on shrinkable flex containers, `truncate` on text, `flex-shrink-0` on must-stay-visible elements.

4. **Supabase Realtime requires publication registration**: Table must be in `supabase_realtime` publication. Frontend subscription alone is not enough.

5. **`.maybeSingle()` returns null on multiple matches**: Silently discards ALL results. Exclude known duplicates (demo user) from queries.

6. **Every routing decision must be logged**: Include resolved userId, bridge mode, demo user flag. Without logs, debugging call routing is impossible.

7. **Fallbacks must announce failures audibly**: When TTS fails, use OpenAI audio to speak the error. Never be silent.

8. **Semantic VAD + text-only is under investigation**: OpenAI semantic VAD with `modalities: ["text"]` may not reliably trigger responses. Added tracing.

9. **Always deploy immediately after code changes**: Code changes that sit undeployed create phantom bugs. The published URL runs old code.

10. **Push notification triggers must cover error paths**: If the user is away and the AI request fails, they need to be notified. Both success and error must trigger push.

11. **Activity logging for push decisions**: Log whether visibility was hidden/visible and whether push was sent/skipped. Without this, push debugging is impossible.

12. **Enforcement mechanisms are required**: Without `.lovable/rules.md`, tracker updates and deployments are routinely skipped.

---

## Known Configuration

### Call Delivery Pipeline

```
notification-scheduler (hourly cron)
  └─> Creates scheduled_notifications entries (type: scheduled_call)
      └─> notification-delivery (every 60s cron)
          └─> Processes due entries
              └─> For phone: invokes twilio-voice-handler
              └─> For chat: invokes send-chat-message
              └─> For slack/email: invokes send-unified-notification
```

**Note**: `twilio-scheduled-call` exists and has `processRecurringCalls()` code, but is NOT called by any cron job. All working calls flow through `notification-delivery`.

### Cron Jobs (supabase/config.toml)

| Job | Schedule | Function |
|-----|----------|----------|
| notification-scheduler | Every hour | `notification-scheduler` |
| notification-delivery | Every 60 seconds | `notification-delivery` |

---

## Pending Solutions

### VOICE-05: Semantic VAD Investigation

**Current status**: Added tracing logs to capture:
- `[VAD-TRACE]` for `speech_started` and `speech_stopped` events
- `[OPENAI-SESSION]` for session config (modalities, turn_detection)
- `responseCreateCount` tracking

**Next steps after data collection**:
- If VAD events fire but no `response.create` auto-triggered → issue is OpenAI semantic VAD with text-only mode
- If VAD events don't fire → issue is audio format or buffering
- Potential fix: fallback timer that announces rather than silently forcing response
