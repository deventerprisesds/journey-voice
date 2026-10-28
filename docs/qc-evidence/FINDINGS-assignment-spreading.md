# FINDINGS — why DBA assignments are not spread out and worked a little at a time

# WHAT:       fact-finding + fix plan for "assignments aren't being spread out and scheduled" — what TaskOS (journey-voice) reads from Nexus today (main + live), what is on the board, how the scheduler treats far-due work, what the parked restore code has, and the smallest fix.
# WHY:        owner 2026-10-28 (verbatim): "the assignments aren't being spread out and scheduled so I have been surprised about things due and not working on them a little at a time until done. That needs to be fixed before the rest ... Part of the problem may be not pointing to the correct tables in nexus from taskos."
# SUPERSEDES: nothing. Builds on (does not repeat) branch claude_schedule-sanity-timing docs/qc-evidence/RESEARCH-assignment-scheduling-history.md (E1–E14), DECISION-j5-j2-j8.md, RESTORE-J1-J15-diff.md; and branch claude_restore-j7-nexus-assignments docs/qc-evidence/RESTORE-step7-j7-scope.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main 9c81e5f (2026-10-28); live Supabase wwxgajrtmslzklnyplah read-only SELECTs 2026-10-28; nexus-hub db-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Fact-finding only. No production code, no deploy, no DB writes.

Status: IN PROGRESS (sections appended as completed)

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
