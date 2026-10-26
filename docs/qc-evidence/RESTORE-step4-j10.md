# RESTORE step 4 — J10 (timezone-aware overdue reminders + quiet hours) and J13's calendar-alarm skip

WHAT: restores J10 and J13's `notification-scheduler` hunk onto current main. Overdue-task pushes fire at the USER's 9am, never during quiet hours. A calendar event that is only a task's mirror no longer gets a second, task-less alarm.
WHY: live `notification-scheduler` v581 (2026-10-19) is byte-identical to main. Main fires overdue reminders on `now.getHours() === 9` (server clock = UTC), which is 05:00 in New York (04:00 after DST ends), and does not check quiet hours. Spec: `RESTORE-J1-J15-diff.md` §J10/§J13, apply-order step 4. Owner: "Option a surgical restore approved".
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: branch `claude_restore-j10-notify-timezone`; commits listed per step below; live source read with Supabase MCP `get_edge_function` on 2026-10-26; read-only `SELECT` on `notification_prefs` on 2026-10-26.

Labels: **O** = observed in this pass. **I** = inferred.

## Step 4.0 — re-verifying the spec's claims before trusting them (O)

| claim in the spec | check | result |
|---|---|---|
| main has not touched `notification-scheduler` since the split | `git log 0459770..origin/main -- supabase/functions/notification-scheduler` and `git log nsishi..origin/main -- …` | both empty |
| the branch file applies cleanly | `git checkout nsishi -- …/index.ts` compared with `git merge-tree --write-tree origin/main nsishi` (tree `72d3cd8`, the same tree the spec cites) | byte-identical |
| live = main | `get_edge_function notification-scheduler`: v581, 4 bundled files (`index.ts`, `_shared/digest-content.ts`, `_shared/timezone.ts`, `_shared/notification-channels.ts`) diffed against `origin/main` (`aeef3d3`) | 0 diff lines in all 4 |
| J10 needs `_shared` | the branch diff touches only `notification-scheduler/index.ts` | no `_shared` change needed |

Live user settings (O, read-only `SELECT` on `notification_prefs`): 25 users have `timezone = 'UTC'`, quiet 22:00–08:00. 1 user has `America/New_York`, quiet 22:00–06:00. No NULL timezones. Every row has overdue reminders on.
Consequence (I, high confidence): for the 25 'UTC' users nothing changes, because their 9am local IS 09:00 UTC. The change is felt by the New York user.

## Step 4.1 — the branch's file, verbatim

Commit: see the branch log. It is J10 (`74ba671`) plus J13's scheduler hunk (`250c3b1`), exactly as in the 3-way merge.
Commit `b9f7e2d`.

## Step 4.2 — one timezone method, and the rules moved where a test can reach them

Commits `8e5c0b8` and the wiring-test commit after it.
- `index.ts` calls `serve()` when imported, so nothing in it can be unit-tested. The rules moved to `notification-scheduler/reminder-rules.ts`: `isInQuietHours` (main's code, moved verbatim; only trailing spaces on blank lines differ), `overdueRemindersAllowed` (the J10 quiet-hours gate), `generateOverdueReminders`, and `isTaskBackedEvent` (J13's skip).
- The spec suggested unifying the two timezone methods (§J10 "Semantic note"). The overdue 9am check now uses `shouldSendAtLocalHour(now, prefs.timezone, 9)` from `_shared/digest-content.ts`. That is the helper main's digest already uses, imported from the same file, so no `_shared` change. The branch's `new Date(now.toLocaleString(... timeZone))` re-parse is gone from the overdue path.
- One small difference from the branch (O, read): if `timezone` were NULL, the branch fell back to UTC, and `shouldSendAtLocalHour` falls back to `America/New_York` (the same default the digest uses). No live row has a NULL timezone (O), so nothing changes today.

## Proof

**`deno check`** (deno 2.5.6) on `index.ts`, `reminder-rules.ts` and `reminder-rules.test.ts`: rc=0. Caveat (O): the session proxy blocks `deno.land` and `esm.sh`, so the check ran with an import map (in the scratchpad, not committed). The map points `std/http/server.ts` at a local `serve` stub and `esm.sh/@supabase/supabase-js@2.39.3` at `npm:@supabase/supabase-js@2.39.3`. Main's own file also passes this check (rc=0).

**Unit tests**: `TZ=UTC node --experimental-strip-types --test supabase/functions/notification-scheduler/reminder-rules.test.ts`: 11/11 pass. The same file under `deno test`: 10/10 pass (before the wiring test was added). Repo `npm test`: 286/286 pass. Note: the repo's `test` glob does not collect `supabase/functions/notification-scheduler/*.test.ts`, so CI will not run this file until J12's collector (step 1) lands or the glob is widened. That is outside this branch's folder scope.

**Concrete example (unit-level, O)**: the one live New York user, with real settings (America/New_York, quiet 22:00–06:00), and a task 3 days overdue:

| server time (UTC) | user's local time | main (live today) | this branch |
|---|---|---|---|
| 2026-10-26 09:05 | 05:05 EDT, inside quiet hours | **fires** (server hour is 9; no quiet check) | nothing: quiet-hours gate and not 9am local |
| 2026-10-26 13:05 | 09:05 EDT | nothing (server hour is 13) | **fires** once |
| 2026-10-26 13:15 | 09:15 EDT | nothing | nothing (only the first 15-min tick) |
| 2026-11-09 09:05 | 04:05 EST (after DST ends) | **fires** | nothing |
| 2026-11-09 14:05 | 09:05 EST | nothing | **fires** once |
| a UTC user at 09:05 UTC | 09:05 | fires | fires (unchanged for the 25 UTC users) |

Plus: quiet hours that cover 9am (21:00–09:30) suppress the reminder for that day. J13: an event linked to a task by `source_task_id` or by `tasks.external_event_id` is skipped, and a plain meeting is not.

**Mutation proof** (`mutate.sh`, anchors and replacements in files under the scratchpad `mut/j10/`):

| # | defect reinstated | test that must fail | outcome |
|---|---|---|---|
| M1 | overdue check back on the server clock (`now.getHours() === 9 && now.getMinutes() < 15`, main's code) | New York EDT 13:05 UTC fires | FIRED |
| M2 | quiet-hours gate removed (`return !!prefs.overdue_reminders_enabled`) | quiet hours that cover 9am suppress it | FIRED |
| M3 | J13 predicate always `false` | J13 task-mirror skip | FIRED |
| M4 | `index.ts` gate reverted to main's `if (prefs.overdue_reminders_enabled)` | index.ts wiring | FIRED |
| M5 | `index.ts` J13 skip disabled (`if (false && …)`) | index.ts wiring | FIRED |

All five restores were checked: the file matches HEAD.

**Live vs new (O)**: live v581 = main (0 lines). Live v581 vs this branch's `index.ts`: 92 changed lines (+30/−62). Plus the new `reminder-rules.ts`, which the deploy bundles through the import. The test file is not imported, so it is not bundled.

## What will no longer be in place

- **The 09:00 UTC overdue push.** For the New York user, overdue reminders no longer arrive at 05:00 EDT / 04:00 EST. They arrive at 09:00–09:15 local. For the 25 users whose stored timezone is `UTC`, nothing moves.
- **Overdue reminders during quiet hours.** They no longer arrive at all while the user is in quiet hours. They are not queued for later. If a user's quiet hours cover 9:00–9:15 local, that user gets no overdue reminder at all (I, from the code: the reminder only fires in that window).
- **The second, task-less calendar alarm.** A calendar event that is the mirror of a journey task (linked by `source_task_id` or `tasks.external_event_id`) no longer gets its own calendar reminder. The task's own start alarm, which has Done/Doing, is the only one left. A real meeting with no linked task still gets its calendar reminder.
- **The `toLocaleString` overdue path** that the parked branch used. It is replaced by the shared helper. NULL timezone would fall back to New York instead of UTC (no live NULL rows).
- Nothing main gained since the split is lost: main has no commit on this function after `0459770` (O).

## How the owner confirms it live

After merge (auto-deploys `notification-scheduler`): on the next day you have a task overdue by a multiple of 3 days, the "Task Overdue" push arrives just after **9:00am New York time**, and nothing arrives around 5am. A cross-check without waiting: `SELECT notification_type, scheduled_for AT TIME ZONE 'America/New_York' FROM scheduled_notifications WHERE notification_type='overdue_reminder' ORDER BY created_at DESC LIMIT 5;` should show local times of about 09:05, not 05:05.
