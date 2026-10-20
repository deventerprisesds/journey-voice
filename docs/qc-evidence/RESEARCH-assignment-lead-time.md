# RESEARCH — assignment lead time (when to schedule / alert course work)

# WHAT:       what the owner previously decided about WHEN course assignments/readings/discussions should be scheduled and alerted (lead time, how far ahead, reminders).
# WHY:        owner 2026-10-20: "how far ahead will have to be researched as extensive conversations were had to determine when to alert / schedule assignments".
# SUPERSEDES: nothing
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   sources cited inline below (file:line, commit sha, transcript position)

Status: COMPLETE (see bottom).

## Sweep log

### Step 1 (journey-voice main) — OBSERVED
- `supabase/functions/_shared/scheduling-defaults.ts:13-20` — `MAX_ASSIGNMENTS_PER_DAY = 2`, `ASSIGNMENT_URGENT_HOURS = 48`, `ASSIGNMENT_PRIORITY_DAYS = 7`; comment: "Tier A (deadline-critical), Tier B (urgent), Tier C (long-horizon)".
- `nightly-schedule-builder/index.ts:647-690` — tier split: A = due within ±48h (incl. ≤48h overdue); B = 48h–7d ahead OR 48h–7d overdue; C = everything else (>7d ahead, >7d overdue). A/B sorted due ASC, C due DESC.
- `nightly-schedule-builder/index.ts:701-790` — Pass 1A: Tier A pre-placed across a mini-horizon (today → due date), category windows first, then flexible-window override; cap-bypassed.
- `:1014-1022` — generic score: +5 if due within ±48h (`isDueSoon`), +3 if due 2–7 days out.
- `:1038-1049` — "Assignment grace period": assignment 0–7 days overdue → +10 and URGENT override.
- `:1051-1069` — staleness penalty (−3 at 14d overdue, −10 at 30d) skipped for assignments in grace.
- `:1076-1080` — comment: "Per approved plan: Tier A/B keep deadline-jump behavior (immovable external dates); Tier C no longer auto-jumps priority-board work."
- `:1162-1172` — Tier B/C capped at `MAX_ASSIGNMENTS_PER_DAY`/day (2, every day); Tier A bypasses cap.
- `:1582-1640` — Pass 3 top-up: deferred B then C fill days under the cap.
- `docs/SCHEDULING_RULES.md:45-49` — "Assignment-linked tasks must remain eligible until done"; "Due dates on assignment-linked tasks must continue to influence score/order." No lead-time number stated.
- `.claude/actions.md:628-636` (main) — ACT:dba-evenings, owner 2026-10-20 quote (see table).

### Step 2 (git history) — OBSERVED, MAJOR
- Tier constants introduced 2026-04-17 by Lovable (`de58e84` "Save plan in Lovable", `6cefc98`/`4380930`/`d546f5e` "Changes", `f24d005` "Save plan in Lovable"). Grace period: `d60746c` 2026-04-06 "Add assignment grace period".
- **A large body of later assignment-scheduling decisions lives ONLY on the unmerged branch `origin/claude/huddle-journey-integration-xokgv1`** (head `150c027`, 2026-09-14; `git merge-base --is-ancestor dce9f92 origin/main` → NOT_ON_MAIN; local origin refs, not re-fetched — read-only brief). Commits: `e45d30a` 08-28 Nexus repoint; `dce9f92` 08-29 config-driven weekend-aware cap + deadline-triage order; `225a3a7`/`0969b9d`/`06b0eba` 09-03 Nexus everywhere + coursework order; `2a1883f` 09-03 "a recent miss outranks far-future work"; `dce1fbb` 09-03 "guarantee the N most recent misses always lead the coursework queue". Several were DEPLOYED from that branch per its actions.md, so live may have since been overwritten by main's auto-deploy (INFERRED — not checked live).

### Step 2b (Lovable plan history, `.lovable/plan.md`) — OBSERVED
The owner's Lovable chat itself is NOT in git; only Lovable's saved plans are. They record approvals, not the owner's words.
- `824f37a` 2026-04-06 14:44Z plan "Assignment Scheduling Grace Period + Assignments Page": problem "Assignments vanish from scheduling the moment they're due" → "7-Day Grace Period Boost for Past-Due Assignments" so "assignments in their first week past due get scheduled at the top of the day, not penalized". Implemented by `d60746c` 2026-04-06 "Add assignment grace period".
- `f3b2c93` 2026-04-06 plan: Assignments page buckets — `overdue` (past), `due_next` (due within next 7 days), `upcoming` (>7 days out).
- `e18bb9b` 2026-04-06 plan: "The existing weekend / 14-day filters are the wrong behavior for assignment management" (about sheet IMPORT windows, not scheduling lead time); "stop auto-marking overdue assignments as completed".
- `de58e84` 2026-04-17 13:22Z plan (the tier design, "Final tweak locked in"): Tier A due ≤48h (due ASC); Tier B "due 3–7d OR overdue ≤7d" (due ASC); Tier C ">7d OR overdue >7d" sorted due DESC — rationale quoted: "ancient overdue assignments are lowest-value to reschedule — recent misses still have recoverable rhythm/context". Constants `MAX_ASSIGNMENTS_PER_DAY = 2`, `ASSIGNMENT_URGENT_HOURS = 48`, `ASSIGNMENT_PRIORITY_DAYS = 7` "unchanged from prior approvals". Acceptance: "Tier A distributed across hours-until-due"; "Tier B/C ≤2/day distributed across 7-day horizon".
- `51b5f08` 2026-04-17 15:57Z code: "Per approved plan: Tier A/B keep deadline-jump behavior (immovable external dates); Tier C no longer auto-jumps priority-board work."
- `1d57dd5` 2026-04-18 plan: `list_pending_assignments` takes `{programId?, dueWithinDays?}`; notification-delivery should drop ancient/DONE before composing pushes.
- INFERRED: none of the April plans states a positive LEAD TIME ("start N days before due"). The 48h/7d numbers are urgency bands for ordering/boosting, not a "begin work X days ahead" rule.

### Step 2c (unmerged branch `origin/claude/huddle-journey-integration-xokgv1`, read via `git show`) — OBSERVED
- `.claude/actions.md` (branch) §"Per-day cap made config-driven + weekend-aware; assignment order = deadline triage (2026-08-29)": approved plan quoted *"1 make the cap configurable and weekend-aware, 2 reconcile the two caps into one, 3 apply the confirmed order 8.1..1.1"* → user: *"the plan looks good. go until deployed"*. Built `resolveCategoryDailyCap()`, `CategoryMapping.maxPerDayWeekend`, seeded `maxPerDayWeekend: 4` on owner config; `MAX_ASSIGNMENTS_PER_DAY` demoted to fallback. Commit `dce9f92`, deploy run 33251640626. Live: Saturday took 4 assignments.
- Same file, same section: "Tier C sharing the score branch is a deliberate prior decision ('Tier C no longer auto-jumps priority-board work'); making it triage-ordered would let old coursework jump the priority board again. Needs a user decision." → OPEN.
- `supabase/functions/_shared/nexus.ts:241-275` (branch) "COURSEWORK ORDER — five bands, OWNER-FINAL 2026-09-03": 1 upcoming soon (`DEFAULT_SOON_DAYS = 14`) soonest-first; 2 recently missed (`DEFAULT_RECENT_OVERDUE_DAYS = 14`) most-recent-first; 3 future beyond 14d soonest-first; 4 old backlog OLDEST FIRST; 5 undated last. "THIS GOVERNS PLACEMENT, NOT ONLY DISPLAY" — `list_pending_assignments` and the nightly builder both use it.
- `2a1883f` 2026-09-03 commit body: owner's literal spec quoted *"upcoming soon, future, overdue<=14d, old backlog"*; bands 2/3 swapped "Owner-approved" so a recent miss outranks far-future work. Owner-signed-off live order: 8.1, 7.1, 1.1, 2.1, 3.1, 4.1, 5.1, 6.1.
- `docs/ac/nudge-and-ordering-ACs.md` (branch) AC-1: owner wrote expected result *"8.1, 7.1, 6.1, then 1.1, 2.1, 3.1 …"*; `recentDays` 30 → 14.
- `.claude/memory.md:981-1023` (branch) + `dce1fbb`: owner ask *"double check within the last 14 days or the last two ... active assignment dates ... so if a day has three or four assignments across courses they all get scored the same way, and if there's a gap between due dates the throughput isn't so slow."* → `resolveRecentCutoff`, `DEFAULT_RECENT_FLOOR_COUNT = 2` ("Owner-specified 2026-09-03, default 2"), config `assignments.recentFloorCount`. Status per memory: "pushed — NOT DEPLOYED, NOT live-confirmed". Agent note: "ORDERING IS NOT THROUGHPUT" — throughput lever is `maxPerDay`/`maxPerDayWeekend`; owner's "decide whether the per-day cap moves" left OPEN.
- `.claude/memory.md:449-454` (branch): owner model — "EDUCATION = formal degree (MBA/doctorate) → assignments, deadline-tiered, evenings+weekends; PROF_EDUCATION = training/courses → flexible, evenings+weekends."
- `.claude/memory.md:744-748` (branch): undated assignments get dates INFERRED from weekly cadence ("user-approved").
- `.claude/memory.md:833-850` (branch) + `docs/verify/nudge-delivery-loop1.md`: nudge digest held to `config.nudges.deliverAtLocalHour` (default 08:00) because the build runs at 01:00 ET. Nudges are venue/overflow, NOT assignment-due alerts.
- INFERRED: across all branch records, decisions are about ORDER (bands), per-day CAP (weekday 2 / weekend 4), and OVERDUE handling. I found NO record of a positive lead time ("schedule N days before due") or an assignment-specific reminder time.

### Step 3 (alerts / notifications) — OBSERVED
- No assignment-specific alert exists anywhere. Assignment tasks get the GENERIC task reminders from the DB trigger in `supabase/migrations/20260204162508_56f2dfc1-...sql:52-73` (Lovable `d5b9e90` 2026-02-04): `due_tomorrow` at (due_date − 1 day) 09:00, `due_soon` at due − 15 min, `due_now` at due; plus `task_start_reminder` at start_time − `reminder_minutes` (default 15) and `task_start_now`.
- `a31db32` 2026-08-18 (branch only, NOT on main) migration `20260218000000_due_tomorrow_tz_aware.sql`: due_tomorrow moved to 09:00 in the user's TZ instead of 09:00 UTC (=5am ET); commit body says "Applied live". `74ba671` (branch only) made notification-scheduler digest/overdue timing TZ-aware.
- `nightly-assignment-sync/index.ts:155-156,199-200` (main) stamps assignment tasks `due_date = <date>T23:59:59Z` → `due_now` fires 7:59 PM ET, `due_soon` 7:44 PM ET, `due_tomorrow` the prior morning. (Times INFERRED from the arithmetic.)
- `notification-delivery/index.ts:762-777` (main): drops pushes for tasks with `due_date < today AND start_time IS NULL` ("stale assignments the nightly builder skipped — don't ping the user about them").
- `supabase/functions/generate-task-reminders/index.ts:62-96`: 15-min / at-due / 1-day-before reminders (on-demand function).
- `notification-scheduler/index.ts:161`: "Due date and start time reminders are now handled by the database trigger"; `generateDueReminders` ("Remind 1 day before due date") is dead code per `74ba671` body.

### Step 4 (other repos + transcripts) — OBSERVED
- nexus-hub: no alert/reminder/lead-time logic for assignments. `src/pages/Assignments.tsx:135-147` "Due Next" = due between last class session end and next session end (session-bounded, not N days); `:313-315` shows "N days left" badge when ≤3 days.
- journey `src/pages/Assignments.tsx:130-137`: `due_next` = due within 7 days; `:224-228` overdue split recent ≤14 days vs older.
- huddle `docs/SCHEDULING_REDESIGN_HANDOFF.md` (2026-08-11, "DESIGN ONLY, NEVER BUILT"): Layer 4 "Assignments have their own honored window … capped per day, with dated assignments allowed to jump by deadline"; Layer 5 "a deadline item is never pushed past its due date (escalate / warn instead)"; AT-2 "a due-today item that can't fit triggers an overcommit warning, never a silent push past its due date".
- huddle `docs/specs/assignment-widget.md`: drafting-workflow spec; no timing decision.
- eds-claude-skills: nothing relevant.
- Transcripts on disk: only THIS session (`/root/.claude/projects/-home-user/f93a6466-....jsonl`, 8511 lines) + 3 subagent files. The sessions that held the Aug–Sep scheduling conversations (`session_01XHMRHWh75yD6YyB3XPEcwi`, `session_01KDVos2br9AZJMcf6LdkWXy` per commit trailers) are NOT on disk, and Lovable chat (April) is not in git. Owner messages found in this session: line 7780 (2026-10-20T00:35Z), 8013 (18:41Z), 8450 (19:11Z) — quoted in the table.

---

## DECISIONS TABLE

| date | source | what was decided | owner's exact words |
|---|---|---|---|
| 2026-02-04 | journey `supabase/migrations/20260204162508_…sql:52-73` (Lovable `d5b9e90`) | Generic task due reminders: day-before 09:00, 15 min before, at due. Applies to assignment tasks too. | none recorded |
| 2026-04-06 | `.lovable/plan.md` @ `824f37a`; code `d60746c` | 7-day grace period: assignments 0–7 days overdue get +10 and URGENT so they don't "vanish from scheduling the moment they're due". | none recorded (Lovable chat not in git) |
| 2026-04-06 | `.lovable/plan.md` @ `f3b2c93` | Assignments page: "Due Next" = within 7 days; "Upcoming" = >7 days. | none recorded |
| 2026-04-06 | `.lovable/plan.md` @ `e18bb9b` | Overdue assignments stay open, never auto-marked DONE; weekend / 14-day IMPORT filters called "the wrong behavior". | "Your requirement is clear: first run = mass import … later runs = … additions/changes only" (Lovable paraphrase, not owner verbatim) |
| 2026-04-17 | `.lovable/plan.md` @ `de58e84` ("Final tweak locked in"); code in `scheduling-defaults.ts:18-20`, `nightly-schedule-builder/index.ts:647-690` | Three tiers: A ≤48h (due ASC, pre-placed between today and due date, no cap); B 3–7d or overdue ≤7d (due ASC, 2/day); C >7d or overdue >7d (due DESC, 2/day). Constants 2 / 48h / 7d "unchanged from prior approvals". | none recorded (rationale written by Lovable: "ancient overdue assignments are lowest-value to reschedule — recent misses still have recoverable rhythm/context") |
| 2026-04-17 | `nightly-schedule-builder/index.ts:1076-1080` (`51b5f08`) | "Per approved plan: Tier A/B keep deadline-jump behavior (immovable external dates); Tier C no longer auto-jumps priority-board work." | none recorded |
| 2026-08-11 | huddle `docs/SCHEDULING_REDESIGN_HANDOFF.md` §5b, AT-2/AT-4 | Design only: deadline items never pushed past due; overcommit warns instead. Owner approved the DIRECTION, build gated on re-confirmation; never built. | "seriously produces what I'd expect" (owner's validation test, quoted in the doc) |
| 2026-08-18 | `a31db32` (branch only), applied live per commit body | due_tomorrow reminder at 09:00 in the USER's timezone (was 09:00 UTC = 5am ET). | none recorded |
| 2026-08-28 | branch `.claude/memory.md:744-748` | Undated assignments dated by inference from weekly cadence. | "user-approved" (no verbatim) |
| 2026-08-29 | branch `.claude/actions.md` §"Per-day cap…"; `dce9f92` | Cap made config-driven and weekend-aware (`maxPerDayWeekend`, seeded 4 for owner); order = deadline triage (upcoming soonest-first, then overdue most-recent-first). | "1 make the cap configurable and weekend-aware, 2 reconcile the two caps into one, 3 apply the confirmed order 8.1..1.1" → "the plan looks good. go until deployed" |
| 2026-09-03 | branch `_shared/nexus.ts:241-275`; `2a1883f`; `docs/ac/nudge-and-ordering-ACs.md` AC-1 | Five bands, "OWNER-FINAL": 1 due within 14d soonest-first; 2 missed within 14d most-recent-first; 3 due after 14d; 4 older misses oldest-first; 5 undated last. Same order used for display AND placement. | "upcoming soon, future, overdue<=14d, old backlog" (literal spec; bands 2/3 then swapped, "Owner-approved"); expected list "8.1, 7.1, 6.1, then 1.1, 2.1, 3.1 …" |
| 2026-09-03 | branch `.claude/actions.md` "ACT: recent-miss floor"; `.claude/memory.md:981-1023`; `dce1fbb` | The most recent 2 distinct overdue due-DATES always count as recent (floor). Built, NOT deployed. Per-day cap change left open. | "double check within the last 14 days or the last two ... active assignment dates ... so if a day has three or four assignments across courses they all get scored the same way, and if there's a gap between due dates the throughput isn't so slow." |
| 2026-09-03 | branch `.claude/memory.md:833-850` | Nudge digest delivered once at local 08:00 (`config.nudges.deliverAtLocalHour`). Covers venue/overflow nudges, not assignment due alerts. | "you can build nudge as provided" |
| 2026-10-20 00:35Z | this session transcript line 7780 | Readings and assignments should be spread through the evenings. | "none of the readings and assignments we know need to be done in the courses arent being spreadf out through the evenings" |
| 2026-10-20 18:41Z | transcript line 8013; main `.claude/actions.md:628-636` | 2/day cap is weekdays only; work should be done AHEAD of time. | "2 a day limit is only for weekdays not weekends. there should be some logic to try to complete things ahead of time not alerted with little time to work with." |
| 2026-10-20 19:11Z | transcript line 8450 | Lead time must be researched from past decisions; source is Nexus (Canvas imports incl. discussions and readings); long-term view; not hardcoded to DBA. | "how far ahead will have to be researched as extensive conversations were had to determing when to alert / schedule assingments … also dont want this hardcoaded to dba, that is just the starting program going forward" |

## CURRENT CODE BEHAVIOUR (origin/main `aeef3d3`, local refs — OBSERVED)

1. **Intake.** `nightly-assignment-sync` reads journey Supabase `public.assignments` (frozen since 2026-04-06 per main `.claude/actions.md:625,633`) and makes PROF_EDUCATION tasks, `due_date = date T23:59:59Z`, estimate 45/90/180 from level_of_effort, skipping anything >30 days past due (`nightly-assignment-sync/index.ts:31-38,116-119,155-202`). The Nexus repoint is NOT on main.
2. **Scheduling lead time (nightly builder, 01:00 ET, 7-day rolling horizon):**
   - Due within 48h either way → Tier A: placed first, somewhere between today and the due date, category window first then flexible 9–22, no daily cap (`nightly-schedule-builder/index.ts:662-678,701-790`).
   - Due 2–7 days out (or 2–7 days late) → Tier B: sorted ahead of all non-assignment work, due-soonest first, max 2/day (`:1076-1100,1162-1172`). Score +3 for due 2–7d, +5 within ±48h (`:1014-1022`).
   - Due more than 7 days out → Tier C: no deadline privilege; competes on `is_priority → priority_rank → score` with everything else, max 2/day; Pass 3 tops up leftover slots (`:1100-1110,1582-1640`).
   - Overdue 0–7 days → +10, URGENT, no staleness penalty (`:1038-1069`).
   - Cap is `MAX_ASSIGNMENTS_PER_DAY = 2` every day of the week, weekends included (`scheduling-defaults.ts:18`); PROF_EDUCATION also `maxPerDay: 2` (`:40`, and owner config per main `.claude/actions.md:589`).
   - So: there is no "start N days before due" rule. Work gets placement priority only in the last 7 days, and guaranteed placement only in the last 48 hours.
3. **Alerts.** Only the generic task reminders: due_tomorrow (day before 09:00; user-TZ if the branch migration is still the live function body), due_soon (due − 15 min), due_now, plus start-time reminders before each scheduled block. For a `T23:59:59Z` due date those land around 9 AM the day before, 7:44 PM and 7:59 PM ET on the due day (INFERRED arithmetic). Nothing fires earlier than one day before due.

## CONFLICTS / GAPS

- **C1 (OBSERVED): main has none of the Aug–Sep decisions.** Nexus intake, weekend cap (`maxPerDayWeekend`), five-band coursework order, and the recent-miss floor exist only on `origin/claude/huddle-journey-integration-xokgv1` (`git grep` on origin/main for `maxPerDayWeekend|resolveCategoryDailyCap|courseworkOrder|recentFloorCount` → 0 hits). They WERE deployed from that branch (dce9f92 run 33251640626; 225a3a7 run 33788269370; e45d30a run 33132580302). Main later changed `nightly-schedule-builder` (`c11b1a2` 2026-10-18), `nightly-assignment-sync` and `execute-tool` (`ec65855` 2026-10-15), and functions auto-deploy on push to main. INFERRED (high confidence, not checked live): those deploys overwrote the branch versions, so live no longer has the owner's approved order, weekend cap or Nexus intake.
- **C2 (OBSERVED): weekday-only cap.** Owner 2026-10-20 "2 a day limit is only for weekdays not weekends" matches the 2026-08-29 approved `maxPerDayWeekend` (seeded 4). Main still applies 2/day on weekends. The 2026-10-19 config restore lists PROF_EDUCATION "maxPerDay 2" with no `maxPerDayWeekend` (main `.claude/actions.md:589`).
- **C3 (gap): no lead-time rule was ever recorded.** I found no record of an owner decision like "schedule assignments N days before due" or "alert N days ahead", in any repo, plan or commit. Recorded decisions cover ORDER (tiers in April, bands in Sept), the per-day CAP, OVERDUE grace, and day-before-09:00 reminders. The 48h / 7d / 14d figures are urgency bands, not lead times. The owner's 2026-10-20 wording ("complete things ahead of time not alerted with little time to work with") reads as a NEW requirement the current tiers don't meet. INFERRED: the "extensive conversations" are most likely the 2026-04-17 tier design (Lovable chat, not in git) and the 2026-08-29 / 09-03 band and cap sessions (transcripts not on disk). Their records hold no lead-time number. Ask the owner whether a number was agreed in conversation that never made it into a ledger.
- **C4 (OBSERVED): open decision never closed.** Branch actions.md 2026-08-29: Tier C (due >7d) uses the general score, which is a deliberate April decision ("Tier C no longer auto-jumps priority-board work"). Making far-out coursework triage-ordered "Needs a user decision" and was never decided. This is exactly the lever behind "ahead of time".
- **C5 (OBSERVED): throughput question open.** Branch actions.md "recent-miss floor": "(2) decide whether the per-day cap moves — that is the only real throughput lever." Never answered on record.
- **C6 (OBSERVED): readings and discussions have no due-date path.** Main `.claude/actions.md:634`: DBA readings sit in undated Nexus modules (16 Pages + 51 Files, 1 linked to a session). Every recorded rule is keyed on `assignment_id` + `due_date`; undated items go to band 5 "always last" (branch `nexus.ts`). The weekly-cadence inference (branch memory:744) is the only dating mechanism, and it is MIT-specific (`N.1` titles). INFERRED: readings tied to a class session (`class_schedules`) would need the session date as their due date. Nothing recorded decides this.
- **C7 (OBSERVED): hardcoded course scope.** Branch `nightly-assignment-sync:128` pinned one MIT course uuid (verifier finding); branch later added `resolveActiveCourseIds` (era inference, `DEFAULT_ACTIVE_COURSE_ERA_DAYS = 14`). The owner's "dont want this hardcoaded to dba" is consistent with that direction.
- **C8 (OBSERVED): the alert timing fix is not in main's migrations.** The TZ-aware due_tomorrow (`a31db32`) was applied live by MCP but exists only on the branch. A future main migration recreating `handle_task_notifications` from the 2026-02-04 body would put the 5am ET reminder back.
- **C9 (OBSERVED, design only): never past due.** Huddle redesign AT-2/AT-4 ("never a silent push past its due date", overcommit warning). Not built in journey; Tier A defers with a log line only (`nightly-schedule-builder/index.ts:789-790`).

Status: COMPLETE.
