# journey-voice — working rules

## Supabase project & ops facts (relearned too often)
- **Project ref:** `wwxgajrtmslzklnyplah` (the live journey Supabase project).
- **The anon key and project URL are PUBLIC.** The anon key ships in the client app, so hardcoding
  it (e.g. inside a DB trigger's `Authorization: Bearer …`) exposes **no** secret. Only the service
  role key and real secrets must stay out of committed SQL/migrations.
- **The MCP / migration role CANNOT `ALTER DATABASE … SET` GUCs** (`app.settings.*`) — it returns
  *permission denied*. So do **not** design triggers/functions to read config from `app.settings`.
  Put PUBLIC config (project URL, anon key) **inline** in the SQL; keep real secrets in **edge
  function secrets** (`supabase secrets set`) and read them with `Deno.env.get(...)` in the function.
- Applying schema changes: use MCP `apply_migration` (goes straight to the remote project). Edge
  functions deploy via the `deploy-supabase-functions.yml` workflow (`workflow_dispatch`, runs on the
  working branch). `pg_net` is already enabled; async HTTP responses land in `net._http_response`.
  The vault is empty — don't rely on it.

## Huddle task-sync (this repo's outbound half)
journey mirrors every task change to the **Huddle** app so Huddle can prioritize
supabase-independently. This repo owns the **outbound** half:
- `supabase/migrations/*_huddle_task_sync.sql` — `SECURITY DEFINER` trigger fn
  `notify_huddle_task_sync` on `AFTER INSERT OR UPDATE OR DELETE ON public.tasks FOR EACH ROW`. It
  `net.http_post`s (pg_net, async) to the edge fn with `{operation: TG_OP, user_id, task: to_jsonb(...)}`,
  wrapped in `EXCEPTION WHEN OTHERS` so a mirror failure never fails the task write. URL + anon key
  are hardcoded (both public — see above).
- `supabase/functions/huddle-task-sync/index.ts` — resolves the owner email from `profiles`, then
  forwards to Huddle's `/api/public/tasks-sync` webhook with the shared secret.

**Standing rule — reuse `JOURNEY_PROXY_TOKEN`.** The edge fn's webhook auth reuses this existing
shared token (already synced into edge secrets); the deploy workflow syncs it from the GitHub org
secret. **Never introduce a new org secret** for the task sync — it clutters org creds.

**The sync is eventually-consistent** (`pg_net` is async, ~1–3s). Anything verifying propagation must
poll/retry, not assume the mirror updates synchronously.

The Huddle side (mirror table, scoring engine, `prioritize` tool, receiver webhook) lives in the
**huddle-extension-app** repo — see its CLAUDE.md for those facts and the `verify-task-sync` /
`test-agent-serverfn` skills.

## Scheduler — read `.claude/memory.md` before touching scheduling
A heavy, evidence-based assessment of the time-window scheduler + the agreed direction lives in
**`.claude/memory.md`**. Non-obvious facts that were expensive to (re)derive:
- **Placement is journey's job; Huddle only RANKS.** journey owns `tasks`, window defs, and the
  nightly builder → batch scheduler that assign `start_time`.
- **Window config is duplicated 5× and DRIFTED** (`after_work` 17–22 in the placer vs 17–19 in
  UI/tools). Canonical is `supabase/functions/_shared/scheduling-defaults.ts`; not everyone imports it.
- **`smart-calendar-scheduler` (voice/manual) is a divergent engine** — own inline config, no
  common-sense day matching, 4 categories only → results are **path-dependent** vs the nightly builder.
- **Common-sense day/time matching already exists** but ONLY in the batch prompt (`batch-calendar-scheduler`
  RULE 1c) + an OpenAI sanity pass that **silently no-ops if `OPENAI_API_KEY` is unset**. Keywords
  (`contextRules.keywords`) are read ONLY by the nightly builder.
- **Reminders ARE auto-created** by the DB trigger `schedule_task_reminders` on `tasks` (start_time/
  due_date) — NOT by the builders. `generate-task-reminders` edge fn is legacy. Don't rebuild reminders.
- **GUI settings** persist to `public.user_scheduling_prefs.config`; a LIVE **array-vs-string** bug
  means `categoryMappings.*.defaultTimeWindow` (arrays) are silently dropped by the smart scheduler.
- Direction (scoped 80%→100%, **no meal windows**): single source of truth + trait-based common-sense
  in every path (venue-dependent / pinned / impact-if-missed) + value-aware overflow nudge + external-
  meeting confirmation + overdue front-loading. Full trait model + file list in `.claude/memory.md`.

## Scheduler placement is CONFIG-AUTHORITATIVE (HARD RULE — do not drift from this)
The user configures **what can be placed in which window** on an in-app config page, persisted to
`public.user_scheduling_prefs.config` (timeWindows + categoryMappings + contextRules). That config is
the **single source of truth** for placement. Non-negotiable rules:
- **Go by the config. Never reassign a category to a window the config doesn't allow, and never
  "load up" by placing work outside its config-allowed windows.** `_shared/scheduling-defaults.ts`
  values are FALLBACKS used only when the config is absent — they are NOT a license to override the
  user's configured windows.
- **The ONLY thing that overrides a configured window is an APPOINTED (pinned) time** — a booked
  appointment carrying a fixed time (B2). Traits / keywords / priority / "load-up" may only affect
  ordering and *preference among already-allowed* windows; they must never place a task in a window
  the config disallows.
- **"Load up" means: pack each category's ALLOWED windows on the earliest days first so the week
  trails off when work runs out** — within the windows, never by breaking them.
- **Empty windows → Iris NUDGES the user; the scheduler does NOT auto-fill by relaxing rules.** When
  an allowed window has open capacity but no eligible tasks, surface it through the nudge mechanism
  (B3) so Iris asks whether to fill it with other items or add new tasks. Do not widen windows or
  move categories to close a gap.
- **Nail the existing config/window/trait/priority behavior before introducing anything new.**
