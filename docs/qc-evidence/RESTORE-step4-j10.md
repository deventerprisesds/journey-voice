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
