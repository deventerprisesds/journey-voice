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

## 3. Live vs new (Supabase project `wwxgajrtmslzklnyplah`)

(filled in from `get_edge_function` below)

## 4. Deploy blast radius when this merges (O, read from `.github/workflows/deploy-supabase-functions.yml`)

This PR adds files under `supabase/functions/_shared/`. The workflow's change detection says: *"_shared changed -- every consumer bundles it, so deploying all"* → `mode=all` → `supabase functions deploy --project-ref wwxgajrtmslzklnyplah` with no name. **Merging redeploys EVERY function directory on main, not just these three.** For functions whose live code equals main (the spec's section 0.4 found this for every function it read on 10-20) this is a no-op re-bundle. Any function whose live code differs from main would be replaced by main's copy. Orphans that are not on main (`confirm-external-meeting`) are not touched, because a deploy only uploads directories that exist.

## 5. Mutation proofs

(below)

## What will no longer be in place

(below)

## How the owner confirms it live

(below)
