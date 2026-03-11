## DEBUG TRACKER — MANDATORY

Before making ANY code changes:
1. Read `docs/DEBUG_TRACKER.md`
2. Check the Pre-Flight Checklist
3. Review Active Issues for context

After making ANY code changes:
1. Add entries to Change Log table
2. Update Active Issues (new bugs, resolved bugs)
3. Add Attempted Fixes Log entries
4. Add Lessons Learned if applicable
5. Update "Last Updated" date

NEVER deploy edge functions without updating the tracker first.
NEVER skip deployment when code changes are approved.

---

## DOCUMENTATION CATALOG

Before modifying any subsystem, read the relevant documentation first:

| Doc | When to read |
|-----|-------------|
| `docs/ARCHITECTURE.md` | Any structural change, new components, routing |
| `docs/DATABASE_SCHEMA.md` | Any table changes, new queries, RLS policies |
| `docs/EDGE_FUNCTIONS.md` | Any edge function work, new functions, shared utils |
| `docs/DECISION_LOG.md` | Before proposing architectural changes — check if it was already decided |
| `docs/VOICE_SYSTEM.md` | Audio pipeline, WebRTC, Twilio, TTS, voice tools |
| `docs/COMMS_CONSOLE.md` | Chat interface, SSE streaming, message deduplication, thread system |
| `docs/TASK_MANAGEMENT.md` | Task CRUD, Kanban, scheduling, dependencies |
| `docs/CALENDAR_INTEGRATION.md` | OAuth flows, calendar sync, busy slot detection |
| `docs/NOTIFICATIONS.md` | Push notifications, multi-channel delivery, presence tracking |
| `docs/CLOUDFLARE_WORKER.md` | Cloudflare Workers, real-time audio relay |
| `cloudflare/PREFLIGHT_CHECKLIST.md` | **MANDATORY** before ANY Cloudflare worker changes |

### Key Constraints

- **Cloudflare version sync**: When changing ANY code in `cloudflare/`, bump the version string in ALL THREE files: `cloudflare/src/index.ts`, `cloudflare/src/TwilioCallSession.ts`, `.github/workflows/deploy-cloudflare.yml`. The CI health check will fail otherwise. See `cloudflare/PREFLIGHT_CHECKLIST.md`.

- **Voice config sync (3-file pattern)**: `supabase/functions/_shared/config.ts` is the source of truth for timing, filler, and voice constants. Changes must be mirrored to `cloudflare/src/config.ts` and `src/config/voiceConfig.ts`. See `cloudflare/PREFLIGHT_CHECKLIST.md` §7.

- **OpenAI model parity**: The realtime model must match between `supabase/functions/twilio-realtime-bridge/index.ts` and `cloudflare/src/TwilioCallSession.ts`. Mismatches cause different voice behavior on different call routes.

- **Recurring calls**: `schedule_next_call` SQL function accepts `p_days_of_week INTEGER[]` and advances to next valid day. `sync_scheduled_calls` trigger extracts `daysOfWeek` from JSON. `notification-delivery` has a day-of-week guard that skips invalid days. All three must stay in sync.
- **Notification dispatch**: `notification-delivery` owns the lifecycle. `send-unified-notification` only updates existing records, never creates new ones. See `docs/NOTIFICATIONS.md`.
- **Voice pipeline**: Never bypass `call-context-builder.ts` for call context. It's the single source of truth for task filtering + topic ranking. See `docs/VOICE_SYSTEM.md`.
- **OAuth tokens**: Always encrypted via `encrypt_token`/`decrypt_token`. Never store raw tokens. See `docs/CALENDAR_INTEGRATION.md`.
- **Edge function patterns**: Audit existing functions in the same domain before creating new ones. Use `SUPABASE_SERVICE_ROLE_KEY` consistently. See `docs/EDGE_FUNCTIONS.md`.
