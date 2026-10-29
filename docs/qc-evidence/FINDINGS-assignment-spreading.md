# FINDINGS — why DBA assignments are not spread out and worked a little at a time

# WHAT:       fact-finding + fix plan for "assignments aren't being spread out and scheduled" — what TaskOS (journey-voice) reads from Nexus today (main + live), what is on the board, how the scheduler treats far-due work, what the parked restore code has, and the smallest fix.
# WHY:        owner 2026-10-28 (verbatim): "the assignments aren't being spread out and scheduled so I have been surprised about things due and not working on them a little at a time until done. That needs to be fixed before the rest ... Part of the problem may be not pointing to the correct tables in nexus from taskos."
# SUPERSEDES: nothing. Builds on (does not repeat) branch claude_schedule-sanity-timing docs/qc-evidence/RESEARCH-assignment-scheduling-history.md (E1–E14), DECISION-j5-j2-j8.md, RESTORE-J1-J15-diff.md; and branch claude_restore-j7-nexus-assignments docs/qc-evidence/RESTORE-step7-j7-scope.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main 9c81e5f (2026-10-28); live Supabase wwxgajrtmslzklnyplah read-only SELECTs 2026-10-28; nexus-hub db-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Fact-finding only. No production code, no deploy, no DB writes.

Status: COMPLETE 2026-10-28 (sections 1-5)

---

## 1. What TaskOS reads from Nexus TODAY — main AND live

### 1a. OBSERVED — origin/main `9c81e5f` reads NOTHING from Nexus
- `grep -rniE nexus src supabase` (ts/tsx) on main → **one** hit, `supabase/functions/_shared/tool-definitions.ts:286`, and it is example prose in a tool description ("work on the Nexus application"). There is **no Nexus client, no `NEXUS_API_URL`, no `/api/d1/assignments` call** on main. (`_shared/nexus.ts` and `src/utils/nexusAssignments.ts` exist only on the parked branch `claude/huddle-journey-integration-xokgv1`.)
- Every assignment read on main targets journey's own Supabase table **`public.assignments`**:

| reader (main) | file:line | table |
|---|---|---|
| nightly intake (assignment → task) | `supabase/functions/nightly-assignment-sync/index.ts:116-119` (`.from('assignments')…not status in (completed,graded)`) | `public.assignments` |
| Iris/agent tool `list_pending_assignments` | `supabase/functions/execute-tool/index.ts:2812` | `public.assignments` |
| web Task modal picker | `src/components/TaskCreationModal.tsx:236, 263, 967, 975` | `public.assignments` |
| client sync/fetch utils | `src/utils/assignmentSync.ts:26,152,324,336`; `src/utils/assignmentFetching.ts:36,121,161` | `public.assignments` |
| Assignments page | `src/pages/Assignments.tsx:88` | `public.assignments` |
| sheet syncs (WRITE) | `sync-google-sheets/index.ts:251-289`, `sync-mit-sheets/index.ts:235-273` | `public.assignments` |

- How intake is triggered on main: `nightly-schedule-builder/index.ts:312-335` "STEP 0: SYNC ASSIGNMENTS (EMBA + MIT)" POSTs to `nightly-assignment-sync` before every build (also `FocusView.tsx:1012` manual button, and the end of both sheet syncs).

### 1b. OBSERVED — live (Supabase `wwxgajrtmslzklnyplah`, read 2026-10-28 ~20:55Z)
- `list_edge_functions`: **127** functions live vs **51** function dirs on main (`ls supabase/functions` = 52 incl. `_shared`) → ~76 live-only.
- `nightly-assignment-sync` **v253** (updated 2026-10-26 22:44Z) — live source read with `get_edge_function`: it is main's code. `.from('assignments')` on Supabase, `MIT_PROGRAM_ID` literal, `toISOString().split('T')[0] + 'T23:59:59Z'`, 30-day skip. **No Nexus call.**
- `cron.job` (live): there is **no assignment-sync cron job**. The only scheduling cron is `nightly-schedule-builder` `0 5 * * *` (05:00 UTC = 1:00 am EDT), which calls the sync as STEP 0. Other jobs: notification-delivery (*), notification-scheduler (hourly), drain-huddle-turns (*), run-scheduled-ceremonies (*), 4 maint jobs.
- Live proof the intake reads a dead table: `public.assignments` for the owner = **469 rows, newest `created_at` AND `updated_at` = 2026-04-06 19:36Z, 0 rows due from now on**. `activity_log` `nightly_assignment_sync`: 14 runs in 14 days, latest 2026-10-28 05:00:06Z = `{created_count:0, skipped_count:469, skipped_old_count:425, repaired_count:0}`. **Every night it scans 469 April-frozen EMBA/MIT rows and creates nothing.**
- Owner identity: journey `auth.users` `a3378f93-d655-4913-b2fa-ca5b1d8020f1` = `dev@enterpriseds.io` (confirmed); the same uuid is `content.assignments.user_id` in Nexus.

### 1c. OBSERVED — where the DBA assignments actually live (Nexus `nexus_hub`)
Table **`content.assignments`** (`nexus-hub sql/nexus_hub/002_app_tables.sql:108-129`, + `submission_types`, `canvas_meta`, `output_format` from `007`), joined to `content.courses` → `content.programs`. Query: nexus-hub `db-query.yml` run **40767365758** (job 123095024275), 2026-10-28 20:55Z. Owner's DBA rows (program "Doctorate - DBA at University of Michigan"):

| course | title | due (ET) | status | points | note |
|---|---|---|---|---|---|
| MGT-702 | Discussion Board 2 | Sun Sep 27 23:59 | submitted | 100 | |
| MGT-701 | Managing Time & Projects / Doctoral Student Best Practices / Research Interests & Our Program / Finding Balance… | Fri Oct 2 23:59 | active | 100 each | past due; probably done (Nexus does not track MGT-701 submissions, J7 scope §B) |
| MGT-702 | Slide Deck for Seminar 2 Presentations | Tue Oct 6 19:00 | active | 0 | past due |
| MGT-702 | Checkpoint 1 - Introduction | Sun Oct 11 23:59 | submitted | 200 | |
| **MGT-782** | **Research Proposal** | **Fri Oct 30 23:59** | active | NULL | due in 2 days |
| **MGT-702** | **Checkpoint 2 - Details** | **Sun Nov 8 23:59** | active | 200 | |
| **MGT-782** | **Research Paper** | **Wed Dec 9 23:59** | active | NULL | |
| MGT-702 | discussion forum slide deck | — (undated) | active | NULL | NEW since 10-27 (updated 2026-10-27 23:11Z) |
| MGT-701 | Final Grade | — | active | 0 | gradebook total, not work |
| MGT-782 | Residency participation | — | active | 40 | |

- **`level_of_effort` is empty on every DBA row** (and every row returned), so main's sync estimate logic (`nightly-assignment-sync/index.ts:184-190`) would always fall to the 90-min default.
- **"Residency 4 - present ideas and insights from the readings" (Nov 9 per J7 scope doc, job 122439464760 on 10-27) no longer exists in Nexus.** Follow-up run **40767834525** (job 123096683409): `title ILIKE '%residency 4%'` across ALL users → 0 rows; `'%research proposal%'` → 1 row (owner, Oct 30, unchanged). INFERRED: deleted or retitled in Nexus after 10-27 (not determinable from here). Same run: `content.class_schedules` has the DBA sessions **MGT-782 Mon Nov 9 19:00 ET** and **MGT-702 Tue Nov 10 19:00 ET** (and Oct 26/27) — the residency itself is still scheduled.
- `programs.is_active = t` for DBA, EMBA and MIT alike (O, same run) — consistent with the owner's 10-28 ruling that "current" = has open items dated today+, not a Nexus flag.

### 1d. Section 1 verdict
- **OBSERVED:** TaskOS main and live point at the **wrong store**: journey Supabase `public.assignments` (frozen 2026-04-06, EMBA/MIT) instead of Nexus `content.assignments` (live Canvas + manual DBA rows). The owner's hypothesis — *"not pointing to the correct tables in nexus from taskos"* — is confirmed, and is stronger than suspected: TaskOS points at **no** Nexus table at all.
- **OBSERVED:** consequently, **zero** of the 3 dated upcoming DBA deliverables (Research Proposal Oct 30, Checkpoint 2 Nov 8, Research Paper Dec 9) have ever been created as tasks by the sync.
- **INFERRED (high):** the 3 DBA tasks that do exist (Introductions, Residency participation, DB1 — all DONE; plus `origin:'nexus-azure'` EMBA-labelled ones) were created by the parked branch's Nexus sync during the window it was deployed (early Sep), then main's redeploy (10-19 / 10-26) put the Supabase reader back. See RESTORE §0.4.

---

## 2. What is on the board now (journey `public.tasks`, owner `a3378f93-…`, read 2026-10-28 ~21:00Z)

### 2a. OBSERVED
Query: tasks where `assignment_id IS NOT NULL` OR title matches `dba|mgt|782|702|701|checkpoint|proposal|research paper|residency|seminar|discussion|slide deck|doctoral`, plus all open `PROF_EDUCATION`/`EDUCATION` tasks.
- **Open tasks linked to a course assignment (`assignment_id` not null): 1** — `📚 Upload video for case- GROW` (EMBA, BLOCKED, due 2026-01-18, created 2026-09-07 by the branch sync while it was live). Nothing DBA.
- **Open DBA-related task: 1, created by hand today** — `Work on DBA paper for 782` (id `595bbae9…`), `PROF_EDUCATION`, BACKLOG, **due 2026-10-31 03:59:59Z = Fri Oct 30 23:59 ET**, `estimate_minutes 60`, **one** block `2026-10-30 00:30–01:30Z` = **Thu Oct 29 8:30–9:30 pm ET**, `assignment_id NULL`, created `2026-10-28 19:07Z`. INFERRED: this is the owner (or Iris for him) manually creating the Research Proposal work after being surprised by it — the exact symptom reported.
- Other open PROF_EDUCATION tasks are undated self-development items (`Start AI certification course` Wed Oct 28 7–8 pm ET; `Find sample enterprise AI consultants…` Thu Oct 29 7:15–8:15 pm ET).

### 2b. Board vs Nexus — what is missing (owner rules: dated items only, from today on, current course = has open items dated today+)

| Nexus item (content.assignments) | due (ET) | on board? |
|---|---|---|
| MGT-782 Research Proposal | Fri Oct 30 23:59 | **MISSING as an assignment task.** Only the hand-made `Work on DBA paper for 782` (not linked, 1 h, 1 block) |
| MGT-702 Checkpoint 2 - Details | Sun Nov 8 23:59 | **MISSING** |
| MGT-782 Research Paper | Wed Dec 9 23:59 | **MISSING** |
| MGT-782 Residency 4 (per 10-27 query: Mon Nov 9 19:00) | — | **MISSING**, and also no longer returned by today's Nexus query (§1c; being confirmed) |
| MGT-702 discussion forum slide deck | undated | out of scope (dated-only rule) |
| MGT-701 ×4 Oct 2, MGT-702 Slide Deck Oct 6 | past | out of scope (from-today rule; owner chose the 4-card set) |

Under the owner's 10-28 rules the board should hold **3 dated cards today** (Residency 4 is gone from Nexus, §1c); it holds **0** linked ones.

---

## 3. How the scheduler treats a task due weeks away — main AND live

Live = main: `nightly-schedule-builder` v308 and `smart-calendar-scheduler` v579 were redeployed 2026-10-26 22:44Z from main (RESTORE §0.4 found them byte-identical to main at 10-20; not re-diffed this pass — I). The only scheduling cron is the builder at 05:00 UTC (§1b).

### 3a. OBSERVED — the data model allows exactly ONE block per task
- A task's placement is `tasks.start_time` / `tasks.end_time` (one pair) + `is_scheduled`. There is **no work-session / sub-block table**: live `information_schema` search for slot|block|session|schedul|placement|subtask yields only `task_schedule_history` (a log of placements), `tasks_with_schedule` (view), `shadow_run_schedule`, `class_schedules`, notifications and prefs.
- Builder: once a task is placed it goes into `scheduledTaskIds` (`nightly-schedule-builder/index.ts:840, 1391, 1499`) and is excluded from every later day (`:963` `.filter(id => !scheduledTaskIds.has(id))`). So **one assignment = one block of `estimate_minutes`, once, per nightly build.**
- Every night STEP 1.1 "rebuild, not append" clears all non-DONE placements in the next 7 days (`:407-430`) and re-places from scratch. A block that was not finished is rolled over (STEP 1, history action `rollover`) and placed again — still one block.
- `estimate_minutes` exists and IS used as the block length (`:710`, `:808` `task.estimate_minutes || categoryMappings[...].estimatedDuration || 60`), but **never as a total-effort budget**: there is no field for "minutes done so far" or "minutes remaining", and nothing divides effort across days. Live `user_scheduling_prefs` PROF_EDUCATION `estimatedDuration 90`, `maxPerDay 2` (RESEARCH S5). Nexus `level_of_effort` is empty on every DBA row (§1c), so intake would set 90 for everything.

### 3b. OBSERVED — when a far-due assignment gets any deadline privilege
- Tiers (`:648-686`, constants `_shared/scheduling-defaults.ts:19-20` `ASSIGNMENT_URGENT_HOURS = 48`, `ASSIGNMENT_PRIORITY_DAYS = 7`): **A** = due within ±48 h → pre-placed, cap-bypassed, into a mini-horizon "today → due" (`:701-790`); **B** = 2–7 days out (or ≤7 d late) → sorted ahead of everything; **C** = >7 days out → *"no longer auto-jumps priority-board work"* (`:1076-1079`), competes on `is_priority → priority_rank → score`. The horizon is a rolling **7 days** (`:697-698`).
- `isDueSoon` +5 at 48 h, +3 at 3–7 days (`:1016-1024`) — no positive term for anything further out.
- Coursework per-day cap = `MAX_ASSIGNMENTS_PER_DAY = 2` constant (`scheduling-defaults.ts:18`), every day including weekends (RESTORE J5/J8).
- **Consequence (I, high, follows directly from the above):** an assignment due in 3 weeks gets no deadline push until 7 days out, and only a guaranteed slot inside the last 48 h — and even then it is ONE 90-min block. A 6-hour paper is therefore "scheduled" as 90 minutes, two days before it is due.

### 3c. OBSERVED — live proof on real coursework (`task_schedule_history`, owner, read 2026-10-28)

| task | due | est | placements (ET) | pattern |
|---|---|---|---|---|
| 📚 Discussion Board 1 (MGT-702) | Sep 7 | 90 | 09-05 14:30, 09-06 10:00, 09-07 09:00, 09-08 09:00, 09-09 09:00 | first placed **2 days before due**; one block a day, rolled over 4× |
| 📚 Introductions (MGT-701) | Sep 10 | 90 | 09-07 10:30 … 09-26 18:30 (11 placements, one/day) | first placed 3 days before due (task created 09-07); rolled over 11× |
| 📚 Required Capstone 8.1 (MIT) | Sep 1 | 90 | 08-27 → 09-17, 14 placements, one/day | same single block, pushed 13× |
| Work on DBA paper for 782 (hand-made 10-28) | Oct 30 23:59 | 60 | 1 block, Thu Oct 29 20:30–21:30 (0 history rows yet) | **one hour, the night before the day it is due** |

Every row: **exactly one block per day, never two blocks of the same task, never placed earlier than the 48h/7d tiers**. "Rollover" repeats the same block, it does not add sessions.

### 3d. Section 3 verdict
- **OBSERVED:** neither main nor live ever splits an assignment into multiple work sessions; there is no session table and no remaining-effort field. Far-due work is placed at most once per night, and gets deadline privilege only 7 days (sort) / 48 h (guaranteed) out.
- **OBSERVED:** the hand-made Research Proposal task is the exact failure: 1 h, the night before.
- **INFERRED:** even with intake fixed (§1), the owner would still be "surprised" — the scheduler has no notion of "work a little at a time until done". Fixing intake alone is necessary but not sufficient.

---

## 4. What the parked restore code already has for spreading

### 4a. OBSERVED
- Sweep of **every** remote branch (`git branch -r`, excluding eds-wip) under `supabase/functions` and `src` for `finish.?ahead | days.?before.?due | lead.?days | start.?by | work.?ahead | sessionMinutes | splitTask | spread…assign` → **0 hits** on any branch. The only "Lead Time" hit is `NotificationSettings.tsx:830` (notification lead time, not scheduling). Also 0 hits for `work.?session | sessionsNeeded | remaining_minutes | progress_minutes` on xokgv1 and nsishi.
- What the parked stack DOES have that bears on this (from RESTORE §J1–J8 and DECISION §J8, not re-derived):
  - **J5** composite scoring + builder actually enforces category `maxPerDay` (`c5de8f4`), recent-overdue escalation. Ranking only.
  - **J8** one `resolveCategoryDailyCap()` with optional `maxPerDayWeekend` (`_shared/scheduling-defaults.ts:111-151` on branch) used by builder + batch + smart scheduler; 5-band coursework order + recent-miss floor (`_shared/nexus.ts:242-452`). Order and count only. Tier A/B/C thresholds are unchanged on the branch.
  - **J7** Nexus reader `GET {NEXUS_API_URL}/api/d1/assignments?owner=…` (`_shared/nexus.ts:338-341`), `courseworkOrder`; inserts once, never updates (J7 scope verdict row 5); `points>0` filter drops 2 of the 3 dated DBA items (NULL points).
  - **J4** dryRun of the full nightly build with zero writes — the test harness any spreading change needs.
  - **J1** `maxDailyHours` guard (opt-in) and the 180-min-evening capacity note (RESEARCH S4 `e389201`).
- **Did any of it run live?** J7's Nexus sync + execute-tool ran briefly in early Sep (tasks with `origin:'nexus-azure'` created 2026-09-07 05:00Z, §2a/3c). Builder J5/J8 never ran live (RESTORE §J5, §J8 "Live now"). Nothing that spreads work exists to have run.

### 4b. Section 4 verdict
- **OBSERVED:** the parked code has **no** finish-ahead, lead-time or session-splitting logic. Restoring J1–J8 would give correct intake (after J7 fixes), weekday/weekend caps and better ORDER, but each assignment would still be one 90-min block placed ≤7 days out.
- **INFERRED:** spreading must be NEW code. The smallest place for it is the builder's assignment tier pass, because that is where far-due assignment tasks are already enumerated across the whole horizon (`:651-686`).

---

## 5. The fix plan (smallest change set) — PLAN ONLY, nothing built

### 5.0 The shape, in one picture
```
TODAY:  builder 05:00Z ─► nightly-assignment-sync ─► journey public.assignments (frozen 04-06) ─► 0 tasks
                         builder places each task ONCE, 1×90 min, deadline push only ≤7d / guaranteed ≤48h

FIX:    builder 05:00Z ─► nightly-assignment-sync ─► Nexus content.assignments (via nexus-hub-api, read-only)
                              │  P1: create/refresh dated DBA tasks (TZ-correct due, title/due refresh, submitted = flag)
                              ▼
                         builder ─► P3: for each open assignment task, plan N work sessions between today and
                                    the finish-by date, cap 2/weekday & 6/weekend day (P2), place the next 7 days
                                    ─► P4: if the sessions do not fit, ONE Iris digest line today, not the day before
```
Owner decisions honoured (no re-asking): current course = has open items dated today+ (no Nexus write); dated items only, due today+; refresh updates due + title, flags submitted/graded, never auto-closes, never touches a DONE task; J5 composite and J8 floor + weekend cap 6 (ride the scheduler restore, compatible with P3 — §5.6); UTC-day-late fix; E3 weekday cap 2, E4 evenings 19–22 weekdays / 10–20 weekends, weekend evenings not auto-filled, E5 never drop for lateness, E12 finish ahead, E13 not hardcoded to DBA.

### P1 — Intake reads Nexus (fixes "not pointing to the correct tables")
**Files:** `supabase/functions/nightly-assignment-sync/index.ts`; new `supabase/functions/_shared/nexus-read.ts` (≈60 lines: the READ half of branch `_shared/nexus.ts:338-341` only — `GET {NEXUS_API_URL}/api/d1/assignments?owner=<uuid>`, no token, no write client); `supabase/config.toml` only if a new env default is needed.
**What changes:**
1. Replace `.from('assignments')` (`:116-119`) with the Nexus read. Keep main's board lookup (#43 oldest-board `limit(1)`, `:44-52`) and the preload/index (`:55-101`).
2. Open = status NOT IN (`submitted`,`graded`,`completed`) (DBA uses `submitted`).
3. Current course = a course with ≥1 open item whose due ≥ local today (owner 10-28). No program literal, no course pin, no `MIT_PROGRAM_ID`, no `points>0`, no cadence inference.
4. Import only items with a due date ≥ local today (owner B2 + from-today). Today that is **3 cards**: Research Proposal (Oct 30), Checkpoint 2 (Nov 8), Research Paper (Dec 9).
5. Due date = `normalizeDueDate(nexusDue, tz)` — **already exists** in `_shared/timezone.ts` (live bundle) and is unused here. Replaces `toISOString().split('T')[0] + 'T23:59:59Z'` (`:155-156`, `:199-200`). Checkpoint 2 becomes Sun Nov 8 23:59 ET (`2026-11-09T04:59:59Z`), not Mon Nov 9 18:59 ET. (Note: `normalizeDueDate` forces 23:59 local; an item due at 19:00 ET would move to 23:59 — use the exact Nexus instant when it has a time, i.e. `new Date(nexusDue).toISOString()`; see AC-P1-4.)
6. Refresh (owner C-rec): for an already-linked task (`assignment_id` = Nexus id) that is NOT DONE: update `due_date` and `title` (`📚 ` + Nexus title) when they differ, and append `{at, field, from, to}` to `scheduling_context.nexus_changes`. If Nexus status becomes submitted/graded: set `scheduling_context.nexus_status`, do NOT change `status`.
7. One digest per run: if any change/flag happened, insert ONE `scheduled_notifications` row (`notification_type='scheduled_chat'`, existing delivery path, `notification-delivery` main l.632-690) listing the changes. Zero changes → no row.
8. `scheduling_context.source` = the Nexus course code (e.g. `MGT-782`), `origin:'nexus-azure'`, `course_id`.
9. Nexus unreachable → log + `activity_log` `status:'failed'`, create/update nothing, builder continues (non-fatal, as today `:329-335`).
**No longer in place:** the nightly sync stops reading journey `public.assignments` (EMBA/MIT, frozen 04-06). The 30-day skip becomes moot (from-today rule). The web client (`TaskCreationModal`, `Assignments.tsx`, `assignmentSync/Fetching.ts`) and `execute-tool list_pending_assignments` still read the frozen table — **left as is** in this change (client ships only via Lovable; `list_pending_assignments` → Nexus is a follow-on row). Sheet syncs untouched (owner D).
**Test:** unit (`deno test`) on the pure mapper with the 15 live DBA rows from run 40767365758 as a fixture; then live: invoke `nightly-assignment-sync` for the owner and read `public.tasks`.
**Acceptance criteria:**
- AC-P1-1: Given Nexus holds the owner's 3 open DBA items dated today+ (run 40767365758), when the sync runs, then exactly 3 new `PROF_EDUCATION` tasks exist with `assignment_id` = the Nexus ids `aafbf80f…`, `a3c3684e…`, `6616bef3…`.
- AC-P1-2: Given MGT-701's 4 Oct-2 items and MGT-702 Slide Deck (past due, `active`), when the sync runs, then no task is created for any of them.
- AC-P1-3: Given undated items (Final Grade, discussion forum slide deck, Residency participation), when the sync runs, then no task is created for them.
- AC-P1-4: Given Checkpoint 2 has Nexus due `2026-11-09T04:59:59Z`, when its task is created, then `tasks.due_date` = `2026-11-09T04:59:59Z` (Sun Nov 8 23:59 ET), not `2026-11-09T23:59:59Z`.
- AC-P1-5: Given a linked, not-DONE task and Nexus moves its due date, when the sync runs, then the task's `due_date` equals the new Nexus instant and `scheduling_context.nexus_changes` has one entry with from/to.
- AC-P1-6: Given a linked task the owner marked DONE and Nexus still says `active` or changes its date, when the sync runs, then the task row is byte-identical before and after.
- AC-P1-7: Given Nexus marks a linked open task `submitted`, when the sync runs, then `tasks.status` is unchanged and `scheduling_context.nexus_status = 'submitted'`.
- AC-P1-8: Given a run with ≥1 change or flag, then exactly 1 `scheduled_chat` row is created for that run; given a run with 0 changes, then 0 rows.
- AC-P1-9: Given the sync runs twice in a row with no Nexus change, then the second run creates 0 tasks and updates 0 rows (idempotent).
- AC-P1-10: Given a program/course string "DBA" appears nowhere in the new code (grep), when a non-DBA course gets an open item dated today+, then it is imported the same way (E13).
- AC-P1-11: Given `NEXUS_API_URL` returns 5xx, when the builder runs, then the sync reports failure, writes no task, and the builder still completes.

### P2 — Weekday cap 2, weekend cap 6, read from config (owner E3 + J8 decision)
**Files:** `_shared/scheduling-defaults.ts` (a small `resolveCategoryDailyCap(config, category, isWeekend)` — the J8 shape, so the later J8 restore is a no-op merge, not a fork); `nightly-schedule-builder/index.ts` (the `dailyAssignmentCount` check uses it instead of `MAX_ASSIGNMENTS_PER_DAY`); owner config row: `categoryMappings.PROF_EDUCATION.maxPerDayWeekend = 6` (a data write, done at ship time, reversible).
**No longer in place:** the constant 2/day on weekends.
**ACs:**
- AC-P2-1: Given PROF_EDUCATION `maxPerDay 2`, `maxPerDayWeekend 6`, when the builder runs with ≥8 coursework sessions eligible, then no weekday holds >2 coursework blocks and no Sat/Sun holds >6.
- AC-P2-2: Given no `maxPerDayWeekend` key, when the builder runs, then weekends use `maxPerDay` (same as today).
- AC-P2-3: Given weekend coursework, then no coursework block starts in the weekend 19–22 window (07-25 protection intact) and none before 10:00.

### P3 — Work-session spreading (the new behaviour: "a little at a time until done")
**Files:** new `supabase/functions/_shared/work-sessions.ts` (pure planner, unit-tested); `nightly-schedule-builder/index.ts` (assignment tier pass `:648-860` calls the planner; placement reuses the existing slot finder and `accumulatedBusySlots`).
**What changes (rule):** for each open assignment task with a due date: `remaining = estimate_total − minutes of its DONE sessions`; `N = ceil(remaining / sessionLen)`; `finishBy = due − bufferDays` (evening before); spread the N sessions **as evenly as possible across available coursework slots from today to finishBy**, earliest-feasible first when slots are scarce, honouring P2 caps and windows; place those that fall in the 7-day horizon; recompute every night (rebuild model, RESEARCH S7 rule 11) so a missed session re-spreads instead of piling up.
**How a session is represented — this is fork F1 below.** Recommended: session tasks (`📚 Research Paper — session 2 of 5`, same `assignment_id`, `scheduling_context.session_of = <parent task id>`, tag `work-session`), so each has its own calendar block, alarm and Done button and DONE sessions are the progress measure.
**No longer in place:** Tier A's "one cap-bypassed block in the last 48 h" as the only guarantee for coursework (it stays as the fallback for a session that still has not fit); Tier C's "no deadline privilege beyond 7 days" for assignment work (sessions are planned back from the due date regardless of distance — this answers RESEARCH open question 6).
**ACs:**
- AC-P3-1: Given Research Paper due Wed Dec 9 23:59, estimate 300 min, session 90, buffer 1, when the builder runs on Oct 29, then 4 sessions are planned, all on or before Tue Dec 8, and no two on the same day.
- AC-P3-2: Given Checkpoint 2 due Sun Nov 8 and Research Paper due Dec 9 both open, when the builder runs, then the 7-day horizon contains ≥1 session of each (both progress, not one-then-the-other).
- AC-P3-3: Given a planned session's day passes with that session not DONE, when the next build runs, then remaining sessions are re-spread over the remaining days (N unchanged, none placed on a past day).
- AC-P3-4: Given the owner marks the parent assignment task DONE, when the next build runs, then no further sessions are placed and un-started future sessions are removed from the calendar.
- AC-P3-5: Given Research Proposal due Fri Oct 30 23:59 with 2 sessions needed on Wed Oct 28 night, when the builder runs, then sessions land Thu Oct 29 (and Fri Oct 30 only if Thu is full), never after the due instant.
- AC-P3-6: Given a session block, then it lies inside PROF_EDUCATION windows (weekday `evening` 19–22, weekend `weekends` 10–20) and respects P2 caps.
- AC-P3-7: Given non-coursework priority tasks compete for the same evening, then a session already required to meet finishBy is placed before them, and a session not yet required may yield (spread, not hog).
- AC-P3-8: Given the planner is a pure function, then `deno test _shared/work-sessions.test.ts` covers AC-P3-1/3/5 with fixed dates and passes; mutation (remove the "no two on the same day" check) makes it FAIL (mutate.sh).

### P4 — Early warning instead of a last-minute surprise (E12)
**Files:** builder (after P3) appends to the existing one-per-run `scheduled_chat` path (shared with P1's digest).
**ACs:**
- AC-P4-1: Given an assignment whose N sessions cannot all be placed before finishBy, when the builder runs, then one Iris digest line names the item, sessions needed vs free slots and the due date, on that run — not only at 48 h.
- AC-P4-2: Given every session fits, then no warning is sent.
- AC-P4-3: Given 3 such items in one run, then 1 message (3 lines), not 3 messages.

### 5.5 Test approach (all pieces)
1. Pure units first (mapper P1, cap resolver P2, planner P3) with the live fixtures above — zero writes.
2. Main has no builder dryRun (J4 is parked). Either bring J4's `dryRun` flag first (RESTORE step 8 lists it; cherry-pick-clean commits `d113cc6`, `ce1cd3a`) or verify on the live tables after deploy by SQL (`tasks` start/end, `task_schedule_history`). Recommended: J4 dryRun first — it is the only way to see a full build without moving the owner's calendar.
3. After merge/deploy (edge fns auto-deploy on push to main): run `nightly-assignment-sync` once for the owner, then the builder, then read: 3 linked DBA tasks, sessions across the next 7 days, caps honoured, digest row count. Status stays "implemented, NOT confirmed live" until the owner sees sessions on his calendar.

### 5.6 What this does NOT do / interactions
- J5 composite and J8 band order + recent-miss floor: still the planned scheduler restore (RESTORE step 8). Compatible: they order candidates; P3 decides how many sessions and by when. P2 uses J8's resolver shape so that merge is clean.
- Readings and undated items: out (owner: dated only). The undated `discussion forum slide deck` stays off the board until it has a date.
- `list_pending_assignments` (Iris) and the web Assignments page still read the frozen table → one-line row for a follow-on.
- Residency 4 vanished from Nexus between 10-27 and 10-28 (§1c) — nothing to import; worth one question to the owner whether it was intentional (not a fork, just a fact check).

### 5.7 Genuine owner forks (each with a recommended default)

| Fork | What actually happens | Cost / what you lose | Makes easy later | Makes hard later |
|---|---|---|---|---|
| **F1a session TASKS** (recommended) | each work session is its own card/calendar block (`📚 Research Paper — session 2 of 5`) | more cards on the board (and in Huddle's mirror) — mitigated by a `work-session` tag/filter | progress = DONE sessions; alarms + Done buttons per session already work; calendar shows the plan 7 days out | cleanup if you change the estimate (sessions re-plan nightly) |
| F1b one task, "next session" slot | the assignment keeps one card; its slot moves to the next planned evening each night | the calendar shows only the next session, never the plan; no way to record "did 1 h, not done" | a clean board | progress tracking needs a new field later |

Cause→effect: pick F1a → each evening's block is a real task → marking it Done reduces remaining effort → the planner re-spreads what is left. Pick F1b → one block at a time → the system cannot tell partial work from no work → it keeps assuming the full effort remains. **Reversible:** both (code-only; F1a's session cards can be deleted).

| Fork | Recommended default | Why |
|---|---|---|
| F2 Finish-by buffer (days before due) | **1 day** (done by the evening before) | Due times are 23:59; a same-day last session is the "little time to work with" the owner rejected. Configurable `config.assignments.finishBufferDays` |
| F3 Session length | **90 min** (= today's `estimatedDuration`; 2 fill a 19–22 evening exactly) | No new number; matches the 2/weekday cap arithmetic (RESEARCH synthesis) |
| F4 Total effort when Nexus has none (`level_of_effort` empty on every row) | **180 min** (2 sessions) default per assignment, owner/Iris can set any task's `estimate_minutes`; Iris asks once per new assignment in the P1 digest | Nexus gives no effort; a per-title guess would be a hardcode. 90 (today) cannot spread at all |
| F5 Earliest start for far-due work | **no limit** (spread from today) vs e.g. 21 days before due | With 3 items today, no limit gives Research Paper ~1 session/week now and denser later; a cap would recreate the "surprise" |

Everything else in §5 has a safe reversible default and is not a fork.

---

## Build log (P1, P2, dry-run)

Owner-approved 2026-10-28 (top priority). Branch `claude_assignment-spreading`. Labels as above (O / I).

### Correction to §1c / §5.6 (owner, 2026-10-29)
**Residency 4 is a scheduled CLASS SESSION, not an assignment.** Its disappearance from `content.assignments` between 10-27 and 10-28 was a **correction in Nexus, not data loss**; the session itself is still in `content.class_schedules` (MGT-782 Mon Nov 9 19:00 ET). The intake reads only `content.assignments` and never `class_schedules` (O, `_shared/nexus-read.ts`). The only residency-shaped row left in assignments, `Residency participation` (MGT-782, 40 pts), is **undated**, so the dated-only rule already excludes it (test AC-P1-3). No title pattern was added (it would be a hardcode).

### P1 — intake reads Nexus (commit: see git log, "P1")
- **Read path (O):** `_shared/nexus-read.ts` → `GET {NEXUS_API_URL|https://nexus-hub-api.azurewebsites.net}/api/d1/assignments?owner=<uuid>`. nexus-hub `api/src/lib/auth.ts` `resolveOwner` step 4 accepts the unverified `?owner=` for reads; `api/src/functions/d1.ts` `handleGet` returns `{ rows }` from `SELECT * FROM content.assignments` plus `attachCourses` (`courses: {id,name,code}`). **No token, no secret, no new org secret.** `NEXUS_API_URL` is optional (public host default).
- **Decision logic (O):** `_shared/assignment-intake.ts` (pure). Create gate: Nexus status not submitted/graded/completed, has a due date, local due date ≥ local today, course current (≥1 open item dated today+). Due = Nexus instant exactly (`new Date(due).toISOString()`). Status `UP_NEXT` (dated, #28/#33). Oldest default board (#43). Legacy same-title unlinked card → linked, not duplicated.
- **Refresh (O):** linked, not-DONE task → title + due_date follow Nexus; submitted/graded → tag `nexus-<status>` + `scheduling_context.nexus_status`, **status never changed**; DONE (status DONE or completed_at set) → untouched, and the UPDATE itself is guarded `.neq('status','DONE').is('completed_at',null)` against a race.
- **Why the flag is a TAG (O):** `nightly-schedule-builder` replaces `scheduling_context` wholesale on every placement (main :835, :1380, :1490). A flag kept only there is wiped nightly → re-flagged → a nightly repeat message. The builder never writes `tags` (grep), and Huddle's board shows tags as chips. Test AC-P1-7b reproduces the wipe and proves no second flag / no second message. `scheduling_context.nexus_changes` is best-effort history for the same reason (J9 on the parked branch fixes the wipe).
- **One message per run (O):** one `scheduled_notifications` row, `notification_type='scheduled_chat'`, `metadata.message` — the exact shape `_shared/task-dedup.ts` uses, delivered by `notification-delivery` (:632-690) as an Iris chat + push. Built from writes that actually succeeded. **Sent when the owner's quiet hours end** (`notification_prefs` 22:00–06:00 ET live): the sync runs at 05:00 UTC = 1 am ET and the scheduled_chat path does not apply quiet hours itself, so "now" would ring the phone at 1 am (test AC-P1-8b).
- **Nexus down (O):** `ok:false` → no task read/write, `activity_log status:'failed'`, HTTP 502; the builder's STEP 0 already treats a non-OK response as a non-fatal warning (main :329-335).
- **Dry run (O):** body `{ userId, dryRun: true }` → reads Nexus, boards, tasks; returns `would_create` / `would_update` / `excluded` / `digest` preview; **no insert, no update, no activity_log, no notification.**
- Tests: `_shared/assignment-intake.test.ts` 24 named tests (AC-P1-1..13, DRY-1, READ-1). `npm test` 329 → 353, 0 fail. `deno check` (remote imports stubbed; deno.land is proxy-blocked here) clean; `undef-check` 0 new.

### P2 — coursework caps from Settings (weekday 2, weekend 6)
- **Resolver (O):** `resolveCategoryDailyCap` + `isWeekendInTimezone` + `CategoryMapping.maxPerDayWeekend` copied **verbatim** from parked J8 (`claude/huddle-journey-integration-xokgv1` `_shared/scheduling-defaults.ts` 95-151), so the later J8 restore is a no-op merge for these lines. The one deliberate difference: the seed is **6** (owner 10-28), not J8's 4 — `DEFAULT_CATEGORY_MAPPINGS.PROF_EDUCATION.maxPerDayWeekend: 6` and `src/config/schedulingRules.ts` (one-line conflict at J8 restore time; take 6).
- **Builder (O):** the three cap sites J8 wired (pass-1 B/C cap, top-up day cap, top-up per-task cap) now call the resolver with `dayOfWeek ∈ {0,6}`; no comparison against the bare constant remains (test AC-P2-1b). Tier A still bypasses the cap (unchanged).
- **Settings UI (O):** "Max Per Day (weekends)" field beside "Max Per Day" (J8 text). Client ships only via Lovable.
- **Live effect (O, read 2026-10-29):** the owner's saved `PROF_EDUCATION` row is `{maxPerDay 2, evening+weekends, 90 min}` with **no** `maxPerDayWeekend`, so after deploy weekends still cap at 2 (AC-P2-2) until `maxPerDayWeekend: 6` is written to that row (Settings field, or one reversible data write at ship time). The seed only applies to users with no saved row.
- **Not changed (O):** `smart-calendar-scheduler` (:648-658) and `batch-calendar-scheduler` still read `maxPerDay` alone; J8 restore wires them.
- Deno check of the builder: identical 19 pre-existing implicit-any errors before and after (stub artefacts), 0 new.

### Mutation proofs (P1 + P2) — `mutate.sh`, anchors in files, exact test names
| # | file | defect reinstated | named test | outcome |
|---|---|---|---|---|
| m1 | assignment-intake.ts | create gate ignores "due today or later" | AC-P1-2 | FIRED |
| m2 | assignment-intake.ts | undated items not excluded | AC-P1-3 | FIRED |
| m3 | assignment-intake.ts | DONE tasks refreshed like open ones | AC-P1-6 | FIRED |
| m4 | assignment-intake.ts | due = UTC day + `T23:59:59Z` (the old bug) | AC-P1-4 | FIRED |
| m5 | assignment-intake.ts | submitted flag also sets `status: DONE` | AC-P1-7 | FIRED |
| m6 | assignment-intake.ts | "already flagged" read from scheduling_context (builder wipes it) | AC-P1-7b | FIRED |
| m7 | assignment-intake.ts | current-course gate removed | AC-P1-10 | **INERT — behaviourally equivalent**: any item passing "open + dated today+" makes its own course current, so the explicit gate is redundant by construction. Kept as the owner's rule written in code; NOT claimed as a proven guard. |
| m8 | assignment-intake.ts | digest sent with zero lines | AC-P1-8 | FIRED |
| m9 | assignment-intake.ts | quiet hours ignored (1 am push) | AC-P1-8b | FIRED |
| m10 | nexus-read.ts | 5xx body trusted | AC-P1-11 | FIRED |
| m11 | assignment-intake.ts | due compared as strings, not instants | AC-P1-9 | FIRED |
| m15 | assignment-intake.ts | same-title legacy card duplicated | AC-P1-12 | FIRED |
| m12 | nightly-schedule-builder | pass-1 cap back to the constant | AC-P2-1b | FIRED |
| m16 | nightly-schedule-builder | top-up day cap back to the constant | AC-P2-1b | FIRED |
| m13 | scheduling-defaults.ts | resolver ignores the weekend value | AC-P2-1 | FIRED |
| m14 | scheduling-defaults.ts | weekend seed 6 removed | AC-P2-2b | FIRED |

### DRY RUN against LIVE data (P1) — 2026-10-29, read-only, nothing written
**How (O):** this session cannot reach `nexus-hub-api.azurewebsites.net` (egress proxy `CONNECT 403`), so the HTTP leg was not exercised from here. The API's `GET /api/d1/assignments` is `SELECT * FROM content.assignments WHERE user_id=$owner` + the courses embed (nexus-hub `d1.ts` handleGet / attachCourses), so the same rows were read with a read-only `SELECT` through the nexus-pg connector and fed to the planner in-process (`planAssignmentSync` + `describePlan`, the exact code the `dryRun:true` request runs). journey side read-only via Supabase MCP: oldest default board `88616650-…`, 430 owner tasks, 59 linked (all DONE, none linked to the 3 dated ids), 0 unlinked same-title open cards.
**Nexus totals (O, SQL):** 566 owner rows = 3 open & dated today+ · 42 open undated · 518 open past-due · 3 submitted. Current courses = MGT-702, MGT-782 (EMBA, MIT and the unassigned rows have no open item dated today+).
**Would create (exact output):**
```
{
  "scanned": 3,
  "current_courses": [
    "MGT-702",
    "MGT-782"
  ],
  "would_create": [
    {
      "assignment_id": "aafbf80f-512a-4ea8-892b-0d9c9548c09e",
      "title": "📚 Research Proposal",
      "course": "MGT-782",
      "due_date": "2026-10-31T03:59:59.000Z",
      "due_local": "Fri, Oct 30, 11:59 PM",
      "status": "UP_NEXT",
      "estimate_minutes": 90
    },
    {
      "assignment_id": "a3c3684e-0dce-4a76-9552-08e59608a428",
      "title": "📚 Checkpoint 2 - Details",
      "course": "MGT-702",
      "due_date": "2026-11-09T04:59:59.000Z",
      "due_local": "Sun, Nov 8, 11:59 PM",
      "status": "UP_NEXT",
      "estimate_minutes": 90
    },
    {
      "assignment_id": "6616bef3-cddb-49b1-b619-d83e660951f8",
      "title": "📚 Research Paper",
      "course": "MGT-782",
      "due_date": "2026-12-10T04:59:59.000Z",
      "due_local": "Wed, Dec 9, 11:59 PM",
      "status": "UP_NEXT",
      "estimate_minutes": 90
    }
  ],
  "would_update": [],
  "untouched_done": 0,
  "excluded": {
    "closed": 0,
    "undated": 0,
    "pastDue": 0,
    "nonCurrentCourse": 0,
    "noBoard": 0
  },
  "digest": {
    "title": "Coursework update: 3 assignments",
    "message": "Coursework update from Nexus:\n\n• New: 📚 Research Proposal (MGT-782) — due Fri, Oct 30, 11:59 PM\n• New: 📚 Checkpoint 2 - Details (MGT-702) — due Sun, Nov 8, 11:59 PM\n• New: 📚 Research Paper (MGT-782) — due Wed, Dec 9, 11:59 PM",
    "lineCount": 3
  }
}
```
(`excluded` is 0 above because only the 3 dated rows were fed in; on the full 566 the planner's create gate excludes the 42 undated + 518 past-due + 3 submitted, matching the SQL totals; the 59 DONE-linked tasks are `untouched_done`.)
**Would update / flag:** none (no linked open task). **Messages:** one Iris `scheduled_chat`, delivered at 06:00 ET (quiet-hours end) when written by the 1 am run.
**Note for the owner (I):** the hand-made `Work on DBA paper for 782` (no Nexus link, different title) stays; after deploy the board will also hold `📚 Research Proposal`. One can be deleted by hand.
