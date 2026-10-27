# RESTORE step 3 — J13 (phone alarm Done/Doing/Backlog/Park via signed action token) + J14 (prune dead FCM tokens)

WHAT: the evidence record for apply-order step 3 of the J1–J15 surgical restore. It lists what was ported onto main, how the port was proven to carry only the branch's own edits, the test and type-check output, a diff of live vs new for each affected function, and what changes live when this merges.
WHY: J13 is broken live. The last `android_alarm_action` row in `activity_log` is 2026-10-14 22:15. Live `send-push-notification` (v586, main's code) mints no action token, so the still-deployed `alarm-action` (v36, orphaned) never receives a token, and Done on a phone alarm fails once the WebView login expires. Owner: "Option a surgical restore approved".
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: spec `docs/qc-evidence/RESTORE-J1-J15-diff.md` on `origin/claude_schedule-sanity-timing` (sections J13, J14, apply order step 3). Source branch `origin/claude/mobile-widget-web-bridge-debug-nsishi` @ `d1059fe`. Split point `0459770`. Base `origin/main` @ `aeef3d3`. Branch `claude_restore-j13-alarm-actions`.

Labels: **O** = observed in this pass. **I** = inferred.

---

## 1. What was ported

| file | change | source commits (nsishi) | main commits since `0459770` |
|---|---|---|---|
| `supabase/functions/_shared/action-token.ts` | new, 117 lines: HMAC-SHA256 token `v1.<claims>.<sig>`. Key = HMAC(SUPABASE_SERVICE_ROLE_KEY, "journey/alarm-action/v1"). No new secret | `aecf460` | none (new file) |
| `supabase/functions/_shared/action-token.test.ts` | new, 61 lines, 7 tests | `aecf460` | none (new file) |
| `supabase/functions/alarm-action/index.ts` | new on main, 170 lines (DOING/DONE/BACKLOG/PARK + trace) | `aecf460`, `8abea8b`, `d1059fe` | none (not on main) |
| `supabase/functions/send-push-notification/index.ts` | +26: mint `actionToken`/`actionUrl` into the FCM data when `taskId` is a uuid (J13); delete a row FCM reports `404 UNREGISTERED` and log `fcm_token_pruned` (J14); `deepLink?`/`tag?` added to the request type | `aecf460`, `cc724d1` | none (O: `git log 0459770..origin/main -- <file>` empty) |
| `supabase/functions/manage-push-subscription/index.ts` | +20/−1: accept `source`; delete OTHER users' rows for the same `fcm_token` ("one device, one owner"); log `fcm_token_registered` | `aecf460`, `cc724d1` | none |
| `supabase/config.toml` | +6: `[functions.alarm-action] verify_jwt = false` | `aecf460` | none |

**NOT touched (per spec):** `notification-delivery/index.ts`. Main already has J13's delivery hunks there (`ALARM_TYPES`, `alarmDeepLink`, per-alarm batch key, `taskId` on single-task pushes, via #44 `275ecc4`). O: `grep` on this branch shows main's `notification-delivery` passes `taskId: batchNotifications.length === 1 ? … .task_id : null` (lines 891/927), which is what the new mint keys on. `notification-scheduler` is left for step 4 (J10).

**Proof the port is surgical (O):** main has not changed any of the six files since `0459770`. So the branch copy is the 3-way result. Checked mechanically:
`diff <(git diff --cached origin/main -- <6 files>) <(git diff 0459770 <nsishi> -- <6 files>)` → **IDENTICAL**. The change on main is exactly the branch's own edits since the split, and nothing else.

**Conflicts:** none.

## 2. Tests and type-check (O)

- `node --experimental-strip-types --test supabase/functions/_shared/action-token.test.ts` → **7/7 pass** (round trip; wrong key; swapped task id; flipped signature byte; expiry and grace; bad prefix/shape/garbage; isUuid).
- `npm test` (repo runner: `src/utils/*.test.ts supabase/functions/_shared/*.test.ts cloudflare/src/*.test.ts`) → **293 tests, 293 pass, 0 fail**. The new file is picked up by the existing `_shared/*.test.ts` glob.
- `deno check` (deno 2.1.4, from npm; deno.land and esm.sh are blocked by this session's proxy, so `deno.land/std http/server.ts` was mapped to a typed `serve` stub and `esm.sh/@supabase/supabase-js@2[.39.3]` to `npm:@supabase/supabase-js@2.39.3`):

| file | new | main's copy, same check |
|---|---|---|
| `_shared/action-token.ts` | 0 errors | n/a |
| `alarm-action/index.ts` | 0 errors | n/a |
| `send-push-notification/index.ts` | 6 × TS2339 `.catch` on `PromiseLike` | 7 errors: 5 × the same `.catch` + `deepLink`/`tag` missing from the request type |
| `manage-push-subscription/index.ts` | 2 × `.catch` + 2 × implicit-any `logErr` | identical 4 |

The `.catch` errors are pre-existing on main: main deploys 5 of them today in this file. They are type-only (supabase-js builders return a real Promise from `.then`), and Supabase's deploy bundler does not type-check (I, high). The one extra is the J14 prune insert, which uses the same pattern. The port **removes** two of main's errors.

## 3. Live vs new (Supabase project `wwxgajrtmslzklnyplah`, read with `get_edge_function` 2026-10-26)

| function | live | new (this branch) | difference |
|---|---|---|---|
| `alarm-action` | v36, 2026-10-08 14:33, `verify_jwt=false`, CI deploy from nsishi. Text = `8abea8b` (O, read) | `d1059fe` | **one header comment line** (`only DOING/DONE` → `(DOING/DONE/BACKLOG/PARK)`). No behaviour change. The live bundle's `_shared/action-token.ts` reads the same as the ported file (O, read side by side) |
| `send-push-notification` | v586, 2026-10-19, `verify_jwt=false`. Reads the same as main's copy (O, read) | main + 26 lines | + action-token mint for single-task pushes; + FCM 404 UNREGISTERED prune with `fcm_token_pruned` log; + `deepLink?`/`tag?` on the request type (type only) |
| `manage-push-subscription` | v586, 2026-10-19, `verify_jwt=false`. Reads the same as main's copy (O, read) | main + 20/−1 | + `source` field; + delete other users' rows holding the same `fcm_token`; + `fcm_token_registered` log |

Live DB state these touch (O, read-only `SELECT`, 2026-10-26):
- last `android_alarm_action` row: **2026-10-14 22:15:26 UTC**.
- `push_subscriptions` with an `fcm_token`: 2 rows, both the owner's (`fcm:<user>` journey bridge, `fcm:app:huddle:…` Huddle bridge). Tokens held by more than one user: **0**. So the "one device, one owner" delete would remove **nothing today**.
- `fcm_send_failed` in the last 7 days: **0** (0 UNREGISTERED). So the prune has nothing to remove today.

## 4. Deploy blast radius when this merges (O, read from `.github/workflows/deploy-supabase-functions.yml`)

This PR adds files under `supabase/functions/_shared/`. The workflow's change detection says: *"_shared changed -- every consumer bundles it, so deploying all"*. That selects `mode=all` → `supabase functions deploy --project-ref wwxgajrtmslzklnyplah` with no name. **Merging redeploys EVERY function directory on main (52), not just these three.**

**Code (O, from `list_edge_functions`):** 50 of the 52 were last deployed at 2026-10-19 16:39:50 UTC. That is after main's last `supabase/functions` commit (`990b60d`, 16:38:14 UTC). `alarm-action` was last deployed 10-08 (diff above). `mcp` was last deployed 2026-07-09. Its live source could not be read (`get_edge_function` returned an MCP internal error twice). Main's last commit to it is 2026-07-08, before that deploy, so **I infer (medium) live = main for `mcp`**; that one is unverified. No repo function is missing live, so nothing new is created. Live-only functions (75, incl. orphan `confirm-external-meeting`) are not touched.

**Auth — found and fixed in this PR (O):** the CLI takes `verify_jwt` from `config.toml`. Per Supabase docs, the default is *"By default, Edge Functions require a valid JWT"*. Seven live functions run with `verify_jwt=false` but had **no** `config.toml` entry: `classify-task-topic`, `huddle-task-sync`, `nightly-assignment-sync`, `run-scheduled-ceremonies`, `send-android-calendar-event`, `test-google-calendar`, `test-outlook-calendar`. Their live entrypoint paths are not CI paths, so the 10-19 project-level event set them, not CI (I, medium). **A deploy-all would have flipped all seven to JWT-required.** Any caller that sends no JWT would then get a 401. Commit 2 pins the seven to `verify_jwt = false`, which is their live value. After the pin, a check of all 52 repo functions finds **0** whose live `verify_jwt` differs from what the deploy will set (O, script over `list_edge_functions` + `tomllib`). This pin only preserves today's state. Whether each of the seven SHOULD require a JWT is a separate, un-researched question. **Potential item to pull:** drop commit 2 if the owner wants those seven JWT-protected. Check their callers first: the `huddle-task-sync` trigger sends the anon JWT; the others were not traced.

## 5. Mutation proofs (O, `mutate.sh`, anchors in files, test cmd `node --experimental-strip-types --test supabase/functions/_shared/action-token.test.ts`)

| mutation in `_shared/action-token.ts` | guard test | outcome |
|---|---|---|
| M1 drop `if (!ok) return null;` (signature result ignored) | a flipped signature byte is rejected | **FIRED**, restored = HEAD, tree clean |
| M2 drop the expiry/grace check | expired tokens are rejected unless inside the grace window | **FIRED**, restored, clean |
| M3 `parts[0] !== PREFIX` → `false` | wrong prefix, wrong shape and garbage are rejected | **FIRED**, restored, clean |
| M4 `UUID_RE.test(s)` → `s.length > 0` (the mint gate in send-push) | isUuid accepts task ids and rejects the strings the phone has historically sent | **FIRED**, restored, clean |

**Unproven (no test exists, same as on the branch):** `alarm-action`'s `user_id` scoping and `STATUSES` allow-list; send-push's `404 + UNREGISTERED` prune match; manage-push's `.neq('user_id', …)` dedupe. These are `serve()` handlers, and the repo has no harness for them. Ported as-is, not tested here.

## 6. Commits on `claude_restore-j13-alarm-actions`

1. `63debce` — the port (six files) + this record.
2. (next) — `config.toml` pins seven functions to their live `verify_jwt=false` + this record completed.

## What will no longer be in place

Every live behaviour that changes once this merges and the deploy-all runs:

1. **Alarm pushes no longer arrive without credentials.** Every FCM push whose `data.taskId` is a uuid now carries `actionToken` (7-day, single task, single user) and `actionUrl` (`…/functions/v1/alarm-action`). This goes in the FCM data payload only, never the web payload, and is never logged. Before: no token, so the phone's Done/Doing/Backlog/Park used the WebView login and failed once it expired. That covers Huddle-app pushes with a journey `taskId` too. Huddle's alarm buttons already act on journey `public.tasks`.
2. **Dead FCM tokens are no longer kept.** A row FCM rejects with `404 UNREGISTERED` is deleted on that first failure and logged `fcm_token_pruned`. Before: kept forever and re-failed on every push. Today there are 0 such failures, so nothing is deleted at deploy.
3. **One phone can no longer belong to two accounts.** When an FCM token is registered, rows for the same token under any OTHER user are deleted. Today 0 rows match. Consequence: if a test or UAT login ever registers the owner's phone, the owner's own row for that phone is removed, and the owner's alarms stop on that phone until it re-registers on the next app open. Sign-out still does NOT unregister.
4. **Registrations are no longer silent.** Each FCM registration (every app open) writes one `fcm_token_registered` row to `activity_log`. This adds rows: one per app open.
5. `alarm-action` is redeployed with a one-line comment change. No behaviour change, and `verify_jwt` stays `false` (now recorded in `config.toml`).
6. All 52 repo functions are re-bundled from main (deploy-all). By the evidence in section 4, no function's code or `verify_jwt` changes. The one unverified case is `mcp` (live source unreadable; inferred = main).
7. Rotating `SUPABASE_SERVICE_ROLE_KEY` now also invalidates every outstanding alarm token. The phone then falls back to its login path.

Nothing main does today is removed. `notification-delivery`, `notification-scheduler` and every other main file are untouched.

## How the owner confirms it live

1. After the merge, check that the `Deploy Supabase Functions` run for the merge commit logged `_shared changed -- every consumer bundles it, so deploying all` and concluded `success`. Then `alarm-action` and `send-push-notification` show a new version above v36 / v586.
2. Wait for an alarm that is delivered **after** that deploy. An alarm already sitting on the phone was minted without a token. Use a `Test-` task scheduled a few minutes out.
3. Tap **Done** on the full-screen alarm. The test is strongest with the app swiped away.
4. A new `activity_log` row appears:
   `SELECT created_at, status, metadata FROM activity_log WHERE activity_type='android_alarm_action' ORDER BY created_at DESC LIMIT 3;`
   Expected: a row newer than 2026-10-14 22:15, `status='completed'`, `metadata.matched=1`, `metadata.status='DONE'`. The task shows `DONE` with `completed_at` set.
5. Only the owner's tap on the real phone confirms it. Until then the status is "implemented, mechanism verified locally (tests + mutations), NOT yet confirmed live".
6. J14: the next app open writes an `fcm_token_registered` row (`metadata.source`). Before this, the last one was 2026-10-15.
