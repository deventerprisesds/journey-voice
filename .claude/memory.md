# Project Memory — journey-voice
Last updated: 2026-07-29

## Purpose & goals
journey: a voice-first personal-assistant app (Lovable-built) — tasks, calendar/scheduling,
notifications, and a realtime voice assistant (Twilio + ElevenLabs). It is the **canonical
source of truth** for the user's tasks and calendar; **Huddle** (multi-agent AI teammates,
separate repo `huddle-extension-app`) mirrors journey's tasks supabase-independently to
prioritize/collaborate on them. React + Vite + TypeScript + shadcn-ui + Tailwind frontend;
Supabase (Postgres + Edge Functions) backend. See `docs/ARCHITECTURE.md` and the other
`docs/*.md` files for deep per-subsystem detail (scheduling, calendar, voice, notifications).

## Architecture
- Frontend: Vite + React + TypeScript + shadcn-ui + Tailwind (`src/`).
- Backend: Supabase project `wwxgajrtmslzklnyplah` — Postgres (`supabase/migrations/`) +
  Deno Edge Functions (`supabase/functions/*`, ~45 functions: calendar sync/scheduling, voice
  (Twilio/ElevenLabs), notifications/push, Huddle proxy + task-sync, assistant tooling, RAG).
  `pg_net` (async HTTP) and `pg_cron` are enabled; the Vault is empty (don't rely on it).
- Extra compute: `cloudflare/` Cloudflare Worker (see `docs/CLOUDFLARE_WORKER.md`).
- Deploy: edge functions via `.github/workflows/deploy-supabase-functions.yml`
  (`workflow_dispatch`, runs on the working branch); Cloudflare via `deploy-cloudflare.yml`.
- Built/maintained partly via Lovable (lovable.dev project `0fb8c311-c754-4e43-8846-ca6a35f90cac`) —
  pushes to this repo sync back to the Lovable project and vice versa.

## Integrations
| Service | Purpose | Status |
|---|---|---|
| Supabase (`wwxgajrtmslzklnyplah`) | canonical DB + edge functions + auth | active |
| Huddle (`huddle-extension-app`) | outbound task-sync mirror (this repo → Huddle) | active |
| Twilio | realtime voice calls (`twilio-realtime-bridge`, `twilio-voice-handler`) | active |
| ElevenLabs | TTS for the voice assistant | active |
| Google/Outlook Calendar | calendar sync (`calendar-*` functions) | active |
| Web Push / FCM | notifications (`send-push-notification`, Android bridge) | active |
| Slack | `send-slack-notification` | active |
| Cloudflare Worker | see `docs/CLOUDFLARE_WORKER.md` | active |

## Key decisions
- **The anon key + project URL are PUBLIC** — safe to hardcode in a trigger's `Authorization`
  header (it already ships in the client). Only the service-role key and real secrets must stay
  out of committed SQL. Real secrets live in edge function secrets (`Deno.env.get(...)`), never
  in `app.settings` GUCs (the MCP/migration role can't `ALTER DATABASE … SET` — permission denied).
- **Migration escape hatch (relearned 3x — 2026-07-27, 2026-07-29):** when Supabase MCP
  `apply_migration` requires approval / is unauthorized in-session, recreate
  `.github/workflows/apply-migration.yml` (`workflow_dispatch`, one `sql` input, POSTs to the
  Supabase Management API with the `SUPERBASE_ACCESS_TOKEN` org secret — no new secret). Each
  `sql` input is ONE statement/transaction (an `ALTER TYPE … ADD VALUE` needs its own dispatch
  before anything can USE the new value). Remove the workflow after use — but recreate it from
  this doc in under a minute next time instead of re-deriving the pattern. Full detail in this
  repo's `CLAUDE.md`.
- **Huddle task-sync is one-way, outbound from here** — `notify_huddle_task_sync` trigger
  (`SECURITY DEFINER`, async `pg_net`) → `huddle-task-sync` edge fn → Huddle's
  `/api/public/tasks-sync` webhook. Eventually-consistent (~1-3s); never assume synchronous.
  Auth reuses `JOURNEY_PROXY_TOKEN` — never mint a new org secret for this.
- **Mandatory dev-discipline gate (session-level, shared with huddle-extension-app):** this CCR
  session has the `eds-claude-skills` Stop-hook gate installed at `/root/.claude/` (home dir, not
  repo-scoped) — bootstrap/memory/actions tracking + stated-plan-before-risky-action always
  required; subagent-authored ACs + subagent `verifier` required for CODE changes. Tracked in
  detail under huddle-extension-app's `actions.md` ACT-2 (same mechanism, don't duplicate here).

## Feature status
| Feature | Status | Notes |
|---|---|---|
| IN_REVIEW task status | done (verified live) | `20260727000000_add_in_review_task_status.sql` + seed migration; agent work lands here, not DONE, until user approval (Huddle-side gate). |
| `definition_of_done` field | done (verified live) | `20260729000000_add_definition_of_done.sql` — backs Huddle's confirm-intent gate (proposed DoD the user confirms before UP_NEXT→DOING). |
| Source-app-aware push targeting | done (verified live) | `register_push_token` execute-tool action; a Huddle push now hits only the Huddle app, not journey, on a shared device. |
| Huddle task-sync (outbound) | done (verified live, eventually-consistent) | See Key decisions above; full pipeline documented in this repo's `CLAUDE.md`. |
| Reminders / `send_push` (channel-aware) | done | Backs both journey's own reminders and Huddle's away-notifications (Huddle reuses this path — see huddle-extension-app memory). |

## Backlog / known follow-ups
- No `.claude/skills/` dir of its own yet in this repo (unlike huddle-extension-app's
  `test-agent-serverfn`/`verify-task-sync`) — skills specific to verifying the journey→Huddle
  sync from the Huddle side live in huddle-extension-app; this repo's own edge-function-level
  verification is still ad hoc (workflow dispatch + job-log reads), not scripted into a skill.
