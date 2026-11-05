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
  functions **auto-deploy on every push to `main`** (`deploy-supabase-functions.yml`, `on: push:
  branches:[main] paths: supabase/functions/**` — it deploys the CHANGED functions) — so the ship flow
  for an edge-fn fix is: merge it to `main` and the deploy fires itself. `workflow_dispatch` is also
  available for a manual re-run (input `function_name`: a name = that one function, "all" = everything).
  **A BLANK `function_name` now FAILS** ("name a function or pass all"): a dispatch has no
  `github.event.before`, so blank used to fall through to deploying EVERY function
  (`scripts/deploy-dispatch-mode.test.mjs` pins this). **A dispatch from a ref that does not contain
  `origin/main` is REFUSED** by `scripts/assert-ref-contains-main.sh` before any secret sync or deploy
  -- merge main into a working branch before dispatching from it. `pg_net` is already enabled; async HTTP responses land in `net._http_response`.
  The vault is empty — don't rely on it.

## Phone push registration — which app registers how (verified 2026-11-05 by reading the code)
Both Android apps are built from `deventerprisesds/android-bridge-template`, but they register their
phone for push by DIFFERENT routes with DIFFERENT credentials. Any change to who may register a device
(e.g. journey #65's "registration needs the user's own login") must be checked against BOTH rows.

| App (config id in android-bridge-template `configs/`) | How the phone registers | Credential journey receives |
|---|---|---|
| **TaskOS** (journey's app, `54beaa01-…`) | native `FcmRegistrar.kt` → journey `manage-push-subscription` `{action: subscribe_fcm}` (plus the web view's own registration) | **the user's own login token** (`Bearer <access_token>`) since android-bridge-template #20 (2026-11-05); before that the public anon key |
| **Huddle** (`8596e6c2-…`) | Huddle web → Huddle server → journey `huddle-proxy` → `execute-tool` `register_push_token`. Huddle's web side never calls `secureStore`, so the native `FcmRegistrar` ships but does nothing there | **the journey server's own service-role key** — `huddle-proxy/index.ts` (~line 199) calls `execute-tool` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` |

- **Consequence:** a server change that refuses the anon key affects TaskOS only (needs a TaskOS rebuild
  first); Huddle is unaffected as long as `register_push_token` keeps accepting the service role.
- **App version numbers are per app.** "1.0.13" was both a Huddle release and an unmerged TaskOS test
  build. Always name the app, the config id, and the commit a build came from.
- **How to rebuild one app:** `build-apk.yml` runs on a push to `main` that changes one
  `configs/<id>/bridge.config.json` (it builds only the app changed in the LAST commit). Bump that
  file's `_buildTriggeredAt` in its own commit; the workflow bumps the version and writes it back.

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
