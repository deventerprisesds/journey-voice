# Actions log — journey-voice

## Scheduling: recency + "work-on-these-today" intake (2026-08-11)
Request: (1) recently-added due-today items must bubble into today's schedule (recency not burying them
under old priorities); (2) when the user signals "work on these today", schedule within appropriate
windows first and treat overflow as FLEXIBLE — displacing lower-priority ORIGINAL board items — instead
of pushing the signaled items to another day; stated priority must still have bearing. Fix the "Add a
task for today" button double-booking + un-blocked external events.

- [DONE] parse_and_create_tasks dryRun 1:1 harness (commit 8d70611) — reproduces the real button flow zero-write.
- [DONE] Conflict-aware apply, flag-gated `conflictAware:true` (commits 4ef7b8c + 0d9bb68), deployed live.
  Windows-first → flexible-today → displace strictly-lower-priority originals; external events inviolable;
  no double-booking; end_time always set; dryRun zero-write. Proven live via pg_net dryRun + overlap SQL
  (overlapping_tasks/events/placed all 0). Independent verifier spawned to confirm.
- [OPEN] Turn the flag ON in the UI (QuickTaskInput → pass conflictAware:true) once the user confirms the
  live before/after looks right — awaiting user sign-off (they wanted to SEE expected outputs first).
- [OPEN/follow-on] Parser assigns LOW to unqualified "add for today" items → they won't displace existing
  MED originals on plain phrasing. To make "signaled for today = displaces lower originals" work without
  explicit priority words, raise priority for button-signaled items (parser or QuickTaskInput).
- [OPEN] Composite scoring switch in nightly-schedule-builder (commit 925d9df) for the recency-bubbling
  half — validated earlier; awaiting user sign-off to make default.

## OPEN — to investigate next (2026-08-12)
- [CHECK] **PROF_EDUCATION maxPerDay:2 not enforced.** Composite 7-day dryRun (rid 567100) placed 4
  PROF_ED tasks on Mon 08-17 (09:00 Complete MIT, 10:00 Start AI cert, 11:00 Import MIT, 12:00 Find
  sample AI consultants) despite config `PROF_EDUCATION.maxPerDay=2`. Cap appears ignored in the
  builder/slotter. Confirm where maxPerDay should be enforced and why it isn't.
- [CORE GAP] **Overdue + just-added "needed yesterday" items don't surface onto TODAY.** User added ~15
  items yesterday (due 08-11, now overdue). Composite (which already demotes is_priority from +10→+2/3)
  still landed only 3 on today (Amex, Reserve vehicle, Research Agentforce) and scattered the rest to
  Thu–Mon. Root: scoring has no strong "overdue AND recently-flagged → do NOW/today" signal — recency is
  only +2, due-soon(±48h incl overdue) +5, both easily outweighed; and even when scored up, day-assignment
  spreads them instead of filling today first. Needs: (a) a real overdue/aging escalation term (grows with
  days overdue, not just a flat +5 within 48h; today only assignment_id tasks get the +10 grace), and/or
  (b) day-assignment that fills TODAY's remaining windows with overdue items before spreading to later days.
  Do NOT hardcode — extend the composite score + the builder's per-day placement. User is firm this is the
  real miss. (Separate from the 1h day-start delay, still traced via tonight's slotter_trace run.)

## Self-serve scoring-model switch (2026-08-20) — DONE (mechanism), pending user live-watch
Request: "build those two pieces (UI toggle + builder config-read) so the switch is genuinely self-serve."
- [DONE] Issue 1 (PROF_ED maxPerDay:2) enforced in slotter (POST-AI VALIDATION 4) — commit c5de8f4,
  deployed; verified live ≤2 PROF_ED/day.
- [DONE] Issue 2 (composite overdue escalation: recent-overdue up to +14, stale +3) — commit c5de8f4,
  deployed; verified live (recent-overdue test task surfaced onto earliest schedulable day). Test task
  47f6d33e cleaned up (0 remaining).
- [DONE] Builder reads per-user config.scoringModel (body override → config → priority-rank) — commit
  5445bc2, deployed to live project (run 32384609426). Verified live via pg_net dryRuns:
  A) config=composite,no override → per_user=composite ✓; B) config=composite,override=priority-rank →
  (pending poll); C) key removed,no override → priority-rank ✓ (pending poll). Config restored to
  original (no scoringModel key) after tests.
- [DONE] UI toggle "Scheduling Strategy → Ranking Model" in SchedulingSettings.tsx; scoringModel added to
  SchedulingConfig type + DEFAULT + mergeSchedulingConfig (so it survives reload) — commit 5445bc2.
  Frontend local build blocked by broken rollup install in sandbox (env, not code); no tsc errors
  referenced the 3 changed files; real UI verify path is GHA/live after merge.
- [OPEN — user's call] Actually FLIP user a3378f93 to composite (toggle in Settings, or set
  config.scoringModel='composite'). Mechanism is ready; the flip is the user's to make so they can
  watch it a week and toggle back. Revert = flip toggle back / remove the key.
- [OPEN/flagged] delivery-time quiet gate for late-night due_soon/due_now pings (notification-delivery).

## Task dedup guard Phase 1 (2026-08-20) — BUILT + DEPLOYED + VERIFIED LIVE + ENABLED
Request: "are we missing a fuzzy dedup? build one — normalized + semantic, surface a note for genuinely
distinct (don't merge), notify me on every dedup so I can review/undo." User decisions: Klarna dupes =
keep Aug-20, removed other two (rows captured for undo). Approach = normalized+semantic.
- [DONE] Ground-truth: journey had NO creation-time dedup (even exact-title). Confirmed in code.
- [DONE] Cleanup: removed 2 duplicate Klarna tasks (kept "Make payments to Klarna" due Aug 20).
- [DONE] `_shared/task-dedup.ts` (signature + semantic + within-batch + fail-open, config-driven),
  `task_dedup_log` migration (applied), wired into execute-tool create_task + parse_and_create_tasks,
  one notification/batch via existing pipeline. Commit 22f145b. Offline tests 10/10. execute-tool
  deployed (run 32389544494).
- [DONE] Verified LIVE: (a) dryRun parse "Make payments to Klarna. Buy a new umbrella." → Klarna
  SKIPPED (signature vs existing), umbrella created; (b) real create_task "Make Klarna payments" →
  skipped, task_dedup_log row w/ full payload, 1 dedup_notice notification delivered. Test artifacts
  (log row + notif) cleaned.
- [DONE] Enabled config.dedup.enabled=true for user a3378f93 (they want it active).
- [OPEN] Phase 2: wire mcp + twilio-voice creation paths; explicit undo action + UI surface.
- [OPEN/calibrate] Semantic thresholds (high 0.90 / possible 0.80) are seeded guesses; short task-title
  embeddings may score differently — calibrate against real title pairs. Signature layer already
  catches the reported case regardless. Config-driven so tunable without deploy.

- [x] ACT: run `sync-setup-script` skill (user request, 2026-08-21). Found `launcher-settings.json`
  rewritten at 15:26 with the eds-enforce hooks missing; re-ran setup.sh from main (1d68993).
  Verified live: all four hook events now `_eds_version: 8` (was 6, then absent), matching
  CURRENT_VERSION=8; `eds-git-guard.sh` + new `eds-agent-guard.sh` both present; platform hooks intact.
