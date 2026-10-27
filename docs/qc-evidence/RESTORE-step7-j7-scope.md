# RESTORE step 7 (J7): scope report — reading assignments from Nexus instead of journey's frozen `public.assignments`

```
WHAT:       Phase 1 scope check for step 7 of the owner-approved surgical restore (J7 = journey
            reads assignments from Nexus on Azure). It covers what J7 hardcodes, what it reads, and
            whether making it program-agnostic is a small parameterisation or a redesign.
WHY:        owner approved "Option a surgical restore". Later instructions limit J7: "All readings
            and assignments are in nexus. focus on dba program." / "i do want to connect Nexus
            assignments to journey but you need to ensure you have a longterm view of them as they
            are refreshed. also dont want this hardcoded to dba, that is just the starting program
            going forward." / "EMBA is the past." / "readings have to have dates created
            logically/strategically given the life of the course and/or module dates they come from."
            J7 as built in August targeted "the live MIT course". This report checks it against the
            later instructions before anything is built.
SUPERSEDES: nothing. Refines the "## J7" section of docs/qc-evidence/RESTORE-J1-J15-diff.md
            (branch claude_schedule-sanity-timing), which compared files but did not check fitness
            for DBA.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   J7 commits e45d30a, 225a3a7, 0969b9d, 06b0eba (read with git show), branch tip
            origin/claude/huddle-journey-integration-xokgv1; a cherry-pick simulation onto
            origin/main fef0e86; nexus-hub origin/main api/src/functions/d1.ts, extension/background.js;
            nexus-hub docs/qc-evidence/RESEARCH-canvas-items-for-scheduling.md (PR #149); two read-only
            SELECTs on live nexus_hub on 2026-10-27, run through nexus-hub `db-query.yml`, runs
            40563126424 (job 122397180432) and 40563538011 (job 122398639457). The
            nexus-pg-mcp-write connector needed re-auth, so the workflow fallback was used.
```

Labels: **O** = observed in this pass. **I** = inference.

## Verdict (read this first)

**Phase 2 was NOT run. The work needs redesign decisions, not a small parameterisation.**

The course-selection hardcode on its own *is* small to remove: a dynamic resolver already exists in
J7's own `_shared/nexus.ts`. But on today's live DBA data, J7 would put the wrong work on the board
even with that hardcode removed:

| # | J7 behaviour | What it does to DBA today (O, live rows 2026-10-27) | Fix size |
|---|---|---|---|
| 1 | Nightly sync pinned to ONE MIT course id | Imports past-due MIT work (MIT is "the past"); no DBA at all | small (the resolver exists) |
| 2 | Keeps only items with `points > 0` (a rule derived from MIT's Captain's Log) | Drops **3 of the 4 upcoming DBA deadlines**: MGT-782 Research Proposal (Oct 31), Residency 4 (Nov 10), Research Paper (Dec 10) all have `points` NULL. Also drops MGT-702 "Slide Deck for Seminar 2" (0 pts) | **needs a rule decision**: no field separates real work from "Final Grade" (0 pts, undated) |
| 3 | "Open" = status not in (completed, graded) | DBA uses `submitted`. Those 3 items (DB1, DB2, Checkpoint 1) count as open, and the age-cutoff exemption puts them on the board as overdue work | small, but it is status vocabulary |
| 4 | Fills missing due dates from a weekly cadence parsed out of "N.1" titles (MIT) | Date generation, which the owner has NOT approved here; meaningless for DBA titles | remove (small), but undated DBA items then stay undated |
| 5 | Inserts a task once and never updates it (an already-linked assignment is skipped) | When Nexus refreshes a due date or marks something submitted, the task does not change. **That fails the owner's "longterm view as they are refreshed" requirement.** No per-course freshness is carried | **new behaviour**: an update/close path plus freshness |
| 6 | Reads `content.assignments` only | Readings (`content.course_materials`) and ungraded discussions are not read at all | out of J7's scope; covered by the unapproved reading-date plan |
| 7 | Web client (picker, Assignments page, fetch/sync utils) is built around an EMBA-vs-MIT split with `MIT_PROGRAM_ID` | DBA rows are labelled "EMBA" and filtered as "not MIT" | **redesign** of the client's program model (pre-existing on main; J7 kept it) |
| 8 | Sheet syncs WRITE EMBA/MIT Google-sheet rows into Nexus using `UAT_BYPASS_TOKEN` | Writes legacy-program data into the source of truth the owner says is now Nexus | should be dropped, and dropping it removes the token prerequisite |

Rows 2, 5 and 7 are design choices. Each changes behaviour in a way the owner should decide, so the
brief's stop condition applies.
**Readings:** J7 does not need dates for undated readings in order to work, because it does not read
readings at all. That stop condition is not what triggered here.

---

## 1. Hardcodes (O; file:line at J7's last commit `06b0eba` unless marked)

### Course / program / user literals

| file:line | literal | what it decides |
|---|---|---|
| `supabase/functions/nightly-assignment-sync/index.ts:129` (inside `ACTIVE_COURSE_IDS`, l.128-130) | `'8036ebab-d1bc-460b-92b0-c45fb312a12e'` — "MIT — Applied Generative AI for Digital Transformation" | **The only courses the nightly sync ingests.** This is the "targets the live MIT course" hardcode |
| `nightly-assignment-sync/index.ts:120` (also :207, :215) | `MIT_PROGRAM_ID = '4793d933-…'` | labels each task 'MIT' or 'EMBA'; anything not MIT is "EMBA" |
| `nightly-assignment-sync/index.ts:173` | `requiredOnly: true` → `_shared/nexus.ts:77` `isRequiredAssignment` = `points > 0` | intake filter derived from the MIT course |
| `nightly-assignment-sync/index.ts:143-162` | `inferMissingDueDates` — weekly cadence, `/(\d+)\.\d+/` title sequence | invents due dates (MIT "7.1 / 8.1" titles) |
| `nightly-assignment-sync/index.ts:255` | `_scoped_active_course` exempts the scoped set from the 30-day cutoff | old open items are imported as overdue |
| `_shared/nexus.ts:71` | `OPEN_EXCLUDED = ['completed','graded']` | `submitted` counts as open |
| `src/components/TaskCreationModal.tsx:75` | `source: 'emba' \| 'mit'` | the picker's whole type model |
| `TaskCreationModal.tsx:195` and `src/utils/assignmentFetching.ts:14` | `DEMO_EMBA_USER_IDS` (2 uuids) | demo-user fan-out |
| `TaskCreationModal.tsx:265, 267, 976, 980, 981` | `MIT_PROGRAM_ID` literal, twice, + `inProgram` / `notInProgram` | splits the picker into EMBA vs MIT buckets |
| `src/utils/assignmentFetching.ts:3, 41, 122, 154` | `MIT_PROGRAM_ID` | EMBA = "not MIT"; MIT = "in MIT" |
| `src/utils/assignmentSync.ts:3, 146, 315` | `MIT_PROGRAM_ID` | MIT-only task creation path |
| `src/pages/Assignments.tsx:16, 106, 151-152, 265-266` and `:61` | `isMitRow`; name matching on 'emba' / 'executive' / 'mit' / 'cto'; **default filter = the EMBA program** | the page's program filter and labels |
| `supabase/functions/sync-mit-sheets/index.ts:252, 260, 299` | `MIT_PROGRAM_ID` | writes sheet rows into Nexus as MIT |

**Which of these J7 introduced (O):** on `origin/main` today, `MIT_PROGRAM_ID`, `DEMO_EMBA_USER_IDS`
and the 'emba' | 'mit' model already exist in `TaskCreationModal.tsx` (main l.187, 261, 965),
`src/utils/programIds.ts:9` and `AssignmentSyncSettings.tsx`. **J7 kept the client's EMBA/MIT model
and only changed where it reads from.** The course-id pin (`8036ebab…`), `points > 0`, the cadence
inference and the scoped age exemption are J7's own.

**Branch tip after J8 (O, for completeness):** the WIP commit `8fe3dc4` (2026-09-03, *"NOT verified,
NOT deployed"*) replaced the course pin with `resolveActiveCourseIds` / `scopeToActiveCourses`
(branch `nightly-assignment-sync/index.ts:203-205`). It made `requiredOnly` a config knob that
defaults to on (l.173) and moved the cadence inference into `_shared/assignment-cadence.ts`, whose
header names the MIT course as its justification. That is J8 work, so taking it means taking
unverified J8 code.

### Hardcoded by inference rather than by literal (I, high)
`_shared/nexus.ts:198` `DEFAULT_ACTIVE_COURSE_ERA_DAYS = 14` was tuned on 2026-09-03 against the EMBA
and MIT ingestion gaps. It is overridable in `config.assignments.activeCourseEraDays`.

## 2. What J7 reads from Nexus, and whether it matches where Canvas data lives now

**Reads (O):** `GET {NEXUS_API_URL}/api/d1/assignments?owner=<journey user uuid>[&course_id=…][&program_id=…]`
(`_shared/nexus.ts:338-341`). One table, `content.assignments`, with columns `id, course_id,
program_id, title, description, type, status, due_date, priority, points, assignment_url, created_at`
and an embedded `courses(name, code)`. Client: `src/utils/nexusAssignments.ts:80`, same endpoint, no
course filter.

**Does that match where Canvas data lives? (O):** yes for assignments. Per nexus-hub's research and the
live query, every Canvas-captured assignment, and every graded discussion, is upserted into
`content.assignments`. `content.capture_receipts` is the ledger of banked raw blobs, not a row source:
- the extension refresh (path A) re-links rows **by Canvas id, then by title**, and PATCHes the existing
  row (`nexus-hub extension/background.js:493-538`). **A Nexus assignment `id` stays the same across
  refreshes**, so J7's `tasks.assignment_id` key is a sound long-term identity (O from code; I that no
  other writer breaks it).
- `capture_receipts.ingested_at` is wrong for path A (research Q4). J7 reads nothing from
  `capture_receipts`, so it has **no freshness signal**. It cannot tell MGT-702 (captured 10-27) from
  a course last captured weeks ago.

**Live DBA rows, 2026-10-27 (O, job 122398639457):**

| course | title | due (UTC) | points | status | Canvas link |
|---|---|---|---|---|---|
| MGT-701 | Introductions; Doctoral Student Best Practices; Research Interests…; Finding Balance…; Managing Time… | 09-10 … 10-03 | 100 each | active | yes |
| MGT-701 | Final Grade | — | 0 | active | yes |
| MGT-702 | Discussion Board 1 / 2; Checkpoint 1 | 09-07, 09-28, 10-12 | 100/100/200 | **submitted** | yes |
| MGT-702 | Slide Deck for Seminar 2 Presentations | 10-06 | **0** | active | yes |
| MGT-702 | **Checkpoint 2 - Details** | **11-09** | 200 | active | yes |
| MGT-782 | **Research Proposal** | **10-31** | **NULL** | active | **no** |
| MGT-782 | **Residency 4 - present ideas and insights from the readings** | **11-10** | **NULL** | active | **no** |
| MGT-782 | **Research Paper** | **12-10** | **NULL** | active | **no** |
| MGT-782 | Residency participation | — | 40 | active | yes |

The three MGT-782 items were created on 2026-10-27 with no `assignment_url` and NULL points. I infer
they came from a non-Canvas writer (a manual or syllabus entry). That matters: any key built on
the Canvas URL would miss them, while J7's Nexus-row-id key does not.

**Program / course level (O, job 122397180432):** `programs.is_active` is **true for DBA, EMBA and
MIT alike**. `courses.term` is "Fall 2026" for MGT-701/702, **blank** for MGT-782, and "July 2026"
for the MIT course. **Nexus has no field that says which program or course is current.**

## 3. Readings and discussions

**J7 reads only `content.assignments` (O).** Consequences:
- **Graded discussions: yes.** Canvas graded discussions are assignment rows (MGT-702 DB1/DB2).
- **Ungraded discussions, announcements, quizzes: no.** Nexus has no row for them (research Q2).
- **Readings: no.** They live in `content.course_materials` (pages/files) with no date column. The
  weekly pages carry the reading lists in their bodies (research Q3). J7 never reads that table.
- Not every item is graded with points: J7's `requiredOnly` rule is a points filter, not a "graded
  items only" rule. It also drops dated, ungraded-by-points work (row 2 of the verdict).

So J7 does **not** need reading dates in order to function. It simply leaves readings out. Adding
readings is the separate, unapproved scheduling plan ("readings have to have dates created
logically/strategically…"), and nothing here starts it.

## 4. Program-agnostic: small parameterisation or redesign?

**The course pin: small.** `resolveActiveCourseIds` (`_shared/nexus.ts:200-228`, added in J7's own
`0969b9d`) infers the active set with no ids in code. It anchors on the newest `created_at` per
course and keeps every course within 14 days of that anchor. Config can pin or exclude courses
(`config.assignments.activeCourseIds` / `excludeCourseIds`). `list_pending_assignments` already uses
it (`execute-tool` hunk in `0969b9d`). Pointing the nightly sync at it is about 15 lines.

**Replayed on today's rows (I, arithmetic on the observed `max_created`):** newest = MGT-782
2026-10-27, cutoff 10-13, so active = **{MGT-782, MGT-702}**. MGT-701 (09-21, all items past) drops
out, and so do EMBA (09-06) and MIT (09-14). **That is the right DBA answer today.** But it is right
for a fragile reason: the signal is *"which course most recently got a NEW assignment row"*, because a
refresh PATCHes existing rows and does not move `created_at`. A quiet fortnight in a live course, or
one stray new row in an old course, flips the set. The extension refresh only runs when the owner
opens a course in Nexus (research Q4).

**What makes it a redesign rather than a parameterisation:**
1. **No authoritative "current" signal exists in Nexus** (§2). The owner can choose among:
   (a) keep the recency inference plus a config pin;
   (b) make "EMBA is the past" real data by setting `programs.is_active = false` for EMBA and MIT in
       Nexus, then read active programs → their courses. That is clean and program-agnostic, but it is
       a write to another app's data;
   (c) derive "current" from upcoming `class_schedules` sessions or upcoming dated assignments.
2. **The intake filter (`points > 0`) has to be replaced, not parameterised.** On DBA it drops 3 of 4
   upcoming deadlines (§2). The obvious replacement, "every open item in an active course", admits
   `Final Grade` (0 pts, undated) and `Residency participation` (undated). Some rule has to decide
   whether undated items become tasks. That rule is close to the unapproved date-planning work.
3. **The long-term view is missing, not mis-set.** The nightly sync never re-reads a linked task
   (O: `if (tasksByAssignmentId.has(assignment.id)) { skipped.push(…); continue; }`, same on main).
   Meeting the owner's requirement needs: due-date/title changes flow to the task; `submitted`
   /`graded` closes or flags it; per-course "last captured" freshness is surfaced. That is new
   behaviour that moves board items, not a restore.
4. **The client is EMBA/MIT-shaped throughout** (§1). Making the picker and the Assignments page
   program-agnostic means replacing the 'emba' | 'mit' source model with "program from Nexus". It is
   pre-existing on main, but it is a redesign of those screens, and they ship only via Lovable.

## 5. Prerequisites: secrets and routes (O)

| route | used by | auth | secret |
|---|---|---|---|
| `GET /api/d1/assignments?owner=` | all reads (edge + browser) | **unverified `?owner=`**, path 4 of nexus-hub `resolveOwner` (`api/src/lib/auth.ts`); the same pattern Huddle uses | **none** |
| `POST/PATCH /api/d1/assignments` with `X-UAT-Token` | `sync-google-sheets`, `sync-mit-sheets` writes only (`_shared/nexus.ts:98-151`) | UAT bypass | edge secret `UAT_BYPASS_TOKEN`, synced from the org secret **`UAT_TOKEN`** by a step in the branch's `deploy-supabase-functions.yml:74-89`. **Main's workflow has no such step** (O: `git grep UAT_BYPASS origin/main -- .github` returns nothing) |

- Browser reads: Nexus API responses carry `Access-Control-Allow-Origin: *` (nexus-hub
  `api/src/lib/auth.ts:27`), so I infer the Lovable client can call it cross-origin. Not exercised live.
- **Is `UAT_BYPASS_TOKEN` set in journey's edge secrets?** Not checked. No tool here lists secret
  names, and main has never synced it. **It only matters if the sheet-sync writes are restored.**
  Because the sheets are EMBA/MIT ("the past") and Nexus is now the source, I recommend dropping
  `06b0eba`'s sheet-sync hunks. Then J7 needs **no secret at all**, and the "no new secrets" rule
  holds trivially.
- Standing-rule tension, flagged rather than solved: nexus-hub research Q5 says that if journey reads
  Nexus, reuse `JOURNEY_PROXY_TOKEN`. No inbound verifier for it exists in Nexus, so J7 relies on the
  unverified read, exactly as Huddle does today.

## 6. Conflicts with main's #28 / #33 / #43 (Summary rows 2, 3, 6) and how the 3-way merge resolves them

Simulated by cherry-picking `e45d30a` → `225a3a7` → `0969b9d` → `06b0eba` onto `origin/main` `fef0e86` (O):

| step | conflicting files | nature |
|---|---|---|
| `e45d30a` | none | clean |
| `225a3a7` | `execute-tool/index.ts` | **import line only**: the branch side also imports `task-dedup.ts` (J6, not on main). Resolution: keep main's import line (`activeCaveats`) and add just the `nexus.ts` import |
| `0969b9d` | `execute-tool/index.ts` | same import line |
| `06b0eba` | `scripts/undef-check.mjs` (a J12 file), `nightly-schedule-builder/index.ts` (J1/J8 context around `courseworkOrder`) | belongs to other restore steps; the builder's coursework order is J8 territory |

**#28 / #33 / #43 survive in the merged tree (O, grep of the simulated result):**
- #28 / #33 (row 2/3): no `status: 'PROF_EDUCATION'` left as a value. `TaskCreationModal.tsx:882`
  and `assignmentFetching.ts:61/143/181` read `status: 'BACKLOG'`; main's explanatory notes are kept
  (`TaskCreationModal.tsx:932`, `assignmentFetching.ts:7`). `mapCategoryToStatus` appears only in a
  comment.
- #43 (row 6): oldest default board, `.order('created_at', { ascending: true })` + `.limit(1)`, at
  `assignmentSync.ts:41-42, 160-161` and `nightly-assignment-sync/index.ts:57-58`.

These four are auto-merges. The only way to lose them is the naive take-the-branch-file restore. The
3-way merge is safe here.

## 7. What Phase 2 would look like, once the owner decides (not built)

A server-only step that keeps all of main's fixes, ported by 3-way merge from `225a3a7`/`0969b9d`
plus `e45d30a`'s nightly-sync hunks, with these changes:

1. course set from `resolveActiveCourseIds` (no ids), with config pin/exclude as already built;
2. **no** `points > 0` filter and **no** cadence date inference;
3. `submitted` treated as not-open;
4. sheet-sync writes left out (no token needed);
5. client files left on main until the program model is redesigned.

It would still lack the long-term update path (verdict row 5) and freshness. Those are the parts
the owner asked for.

## Owner decisions this report surfaces (each option in one line)

**A. What counts as an "active" course?**
- A1: infer from the newest new-assignment date, plus an optional config pin. Exists now; correct for DBA today; fragile.
- A2: set `is_active = false` on EMBA and MIT in Nexus, and read active programs. Clean and program-agnostic; writes Nexus data.
- A3: derive from upcoming class sessions or dated assignments. New logic.
- *Recommendation:* A2 plus the A1 config pin as the override. It turns "EMBA is the past" into data any app can read.

**B. Which items become tasks?**
- B1: every open item in an active course, undated ones too (left undated).
- B2: dated items only; undated ones wait for the reading/date plan.
- B3: keep `points > 0`. Not viable: it drops 3 of the 4 upcoming DBA deadlines.
- *Recommendation:* B2 until the date plan is approved, so no invented dates.

**C. Long-term view: when Nexus refreshes an item, journey should**
- C1: update the task's due date and title, and close it on submitted/graded.
- C2: flag the change only, and leave the board as it is.
- *Recommendation:* C1 for due/title, C2 for status, so nothing disappears without the owner seeing it.

**D. Restore the sheet syncs writing into Nexus?**
- D1: no. The sheets are EMBA/MIT, and leaving them out removes the `UAT_BYPASS_TOKEN` dependency.
- D2: yes, with the token sync step.
- *Recommendation:* D1.

## RESULTS

Phase 1 complete. Phase 2 **not run**, per the brief's redesign stop condition (verdict rows 2, 5
and 7). Nothing was deployed. No Nexus or journey data was written; the two queries were SELECT-only.
`npm ci` in the clone was stopped at the 400 s tool limit (the proxy refused some registry hosts).
It was not retried, because no code was built.

---

# FOLLOW-UP 2026-10-27, after the owner's answers

Owner answers (relayed by the coordinator, 2026-10-27):
- **A = A2**: mark EMBA and MIT inactive in Nexus and read the active programs; the A1 config pin is the override.
- **D = do not restore the sheet syncs**, but leave a note in case a non-Canvas course needs them.
- **B and C**: the owner wants concrete examples before deciding (sections below).

## Parked: sheet syncs (D)

**What they did (O, commit `06b0eba`, 2026-09-03, on `claude/huddle-journey-integration-xokgv1`):**
`supabase/functions/sync-google-sheets/index.ts` (EMBA sheet) and `supabase/functions/sync-mit-sheets/index.ts`
(MIT sheet) stopped writing journey's `public.assignments`. Instead they read the owner's Nexus rows
once per sync and then `POST`/`PATCH`ed Nexus `content.assignments`, matching an existing row by
program + `sheet_row_number`. `sync-mit-sheets` stamps `program_id = MIT_PROGRAM_ID` (l.252, 260, 299).
The write client lives in the same commit's `_shared/nexus.ts` hunk: `uatToken`, `nexusRequest`,
`createNexusAssignment`, `updateNexusAssignment` (06b0eba `nexus.ts:80-151`). It authenticates with
`X-UAT-Token`. The same commit's `.github/workflows/deploy-supabase-functions.yml` step "Sync
UAT_BYPASS_TOKEN to Supabase edge secrets" copies org secret `UAT_TOKEN` into edge secret
`UAT_BYPASS_TOKEN`. If the secret is absent, the syncs refuse to write and say so.

**Why it is not restored:**
1. The two sheets hold EMBA and MIT data ("EMBA is the past"; MIT is also past). Writing them into
   Nexus would push old-program rows into the source of truth.
2. Canvas courses (all three DBA courses) already reach Nexus through nexus-hub's own capture and
   refresh. journey does not need to write anything.
3. The writes need `UAT_BYPASS_TOKEN`, a UAT-named token that can write as any owner. Not restoring
   them keeps journey's Nexus link read-only, with no secret.

**When to revisit:** a future course that is **not on Canvas** and whose assignments live in a
Google Sheet. Then the sheet is the only source, and something has to put its rows into Nexus.
Prefer adding a sheet importer on the **nexus-hub** side, which owns writes. If it is done from
journey instead:
- cherry-pick from **`06b0eba`** only the `sync-google-sheets` / `sync-mit-sheets` hunks, the
  `_shared/nexus.ts` write-client hunk (l.80-151) and the deploy-workflow token step;
- replace `MIT_PROGRAM_ID` with the target program's id from Nexus;
- confirm `UAT_TOKEN` exists as an org secret before deploying.

Earlier history of those two files, for context only: `3f7e8d0`, `73d6b2a`, `778be2e`, `91df60b`.
On main, both functions still write journey's frozen `public.assignments` (`sync-google-sheets/index.ts:251-289`,
`sync-mit-sheets/index.ts:235-273`). Nothing in this restore changes that.

## B: which DBA items become journey tasks, worked on live data (2026-10-27)

**Sources (O):**
- Nexus: every DBA assignment row, from nexus-hub `db-query.yml` run 40575147553 (job 122439464760), times converted to US Eastern.
- journey: `public.tasks` for user `a3378f93-…`, read with a Supabase SELECT.

**Same person on both sides (O):** every DBA row in Nexus belongs to owner `a3378f93-d655-4913-b2fa-ca5b1d8020f1` = `dev@enterpriseds.io`. That is journey's main user (438 tasks). So J7's "journey user id = Nexus owner" assumption holds.

**Rules applied to both options:**
- course set = all DBA courses (A2);
- open = status NOT in (submitted, graded, completed), the corrected rule;
- an item already linked to a journey task is skipped, exactly as the sync does today;
- main's 30-day overdue cutoff applies (on 10-27 it drops anything due before Sep 27).

### Every DBA item, and what happens to it

| course | item | due (ET) | Nexus status | journey today | B1 (every open item) | B2 (dated only) |
|---|---|---|---|---|---|---|
| MGT-701 | Introductions | Wed Sep 9, 11:59 pm | active | **task exists, DONE** (made 09-07 by the branch's Nexus sync while it was live) | skip (linked) | skip (linked) |
| MGT-701 | Doctoral Student Best Practices | Fri Oct 2, 11:59 pm | active | — | **new, 25 days overdue** | **new, 25 days overdue** |
| MGT-701 | Research Interests & Our Program | Fri Oct 2, 11:59 pm | active | — | new, overdue | new, overdue |
| MGT-701 | Finding Balance & Development As A Researcher | Fri Oct 2, 11:59 pm | active | — | new, overdue | new, overdue |
| MGT-701 | Managing Time & Projects | Fri Oct 2, 11:59 pm | active | — | new, overdue | new, overdue |
| MGT-701 | Final Grade (0 pts) | no date | active | — | **new, undated** | not imported |
| MGT-702 | Discussion Board 1 | Sun Sep 6 | **submitted** | task exists, DONE | not open | not open |
| MGT-702 | Discussion Board 2 | Sun Sep 27 | **submitted** | — | not open | not open |
| MGT-702 | Slide Deck for Seminar 2 Presentations (0 pts) | Tue Oct 6, 7:00 pm | active | — | **new, 21 days overdue** | **new, 21 days overdue** |
| MGT-702 | Checkpoint 1 - Introduction | Sun Oct 11 | **submitted** | — | not open | not open |
| MGT-702 | **Checkpoint 2 - Details** | **Sun Nov 8, 11:59 pm** | active | — | **new, upcoming** | **new, upcoming** |
| MGT-782 | **Research Proposal** | **Fri Oct 30, 11:59 pm** | active | — | **new, upcoming (3 days)** | **new, upcoming** |
| MGT-782 | **Residency 4 - present ideas and insights from the readings** | **Mon Nov 9, 7:00 pm** | active | — | **new, upcoming** | **new, upcoming** |
| MGT-782 | **Research Paper** | **Wed Dec 9, 11:59 pm** | active | — | **new, upcoming** | **new, upcoming** |
| MGT-782 | Residency participation (40 pts) | no date | active | task exists, DONE | skip (linked) | skip (linked) |

### What the board gains

**B2 (dated only): 9 new cards.**
```
OVERDUE  📚 Doctoral Student Best Practices                 MGT-701  was due Oct 2
OVERDUE  📚 Research Interests & Our Program                MGT-701  was due Oct 2
OVERDUE  📚 Finding Balance & Development As A Researcher   MGT-701  was due Oct 2
OVERDUE  📚 Managing Time & Projects                        MGT-701  was due Oct 2
OVERDUE  📚 Slide Deck for Seminar 2 Presentations          MGT-702  was due Oct 6
UPCOMING 📚 Research Proposal                               MGT-782  due Fri Oct 30
UPCOMING 📚 Checkpoint 2 - Details                          MGT-702  due Sun Nov 8
UPCOMING 📚 Residency 4 - present ideas … readings          MGT-782  due Mon Nov 9
UPCOMING 📚 Research Paper                                  MGT-782  due Wed Dec 9
```

**B1 (every open item, undated too): 10 new cards** = the same 9 plus
```
NO DATE  📚 Final Grade                                     MGT-701  (a Canvas gradebook total, not work)
```

**The difference between B1 and B2 today is exactly one card, and it is not real work.** The only
other undated DBA item, Residency participation, is already on the board as DONE.

### Three things the examples expose (O), whichever option is chosen

1. **5 of the 9 B2 cards are probably already done.** Nexus still says `active` for the four
   MGT-701 items and the Slide Deck, but Nexus status is not tracking submissions for these. Proof
   (O): MGT-701 "Introductions" is `active` in Nexus while the owner marked its journey task DONE.
   Only MGT-702's DB1/DB2/Checkpoint 1 came through as `submitted`. Main's builder never
   auto-archives assignment-linked tasks (`nightly-schedule-builder` main l.592-603: "stay visible as
   overdue"), so these 5 would sit as overdue until the owner clears them. **A sub-choice for the
   owner:** import past-due items (5 overdue cards), or import only items due from today on (4 cards).
2. **Due dates land up to a day late.** Canvas stores "11:59 pm ET" as early morning UTC of the next
   day (Checkpoint 2 = `2026-11-09T04:59:59Z`). The sync keeps only the UTC **date** and appends
   `T23:59:59Z` (06b0eba `nightly-assignment-sync` l.285-287; **main has the identical line**, l.200).
   So Checkpoint 2 becomes Mon Nov 9, 6:59 pm ET instead of Sun Nov 8, 11:59 pm.
   **Already visible in live data (O):** the existing "Introductions" task holds
   `2026-09-10 23:59:59+00` while Nexus holds `2026-09-10 03:59:59Z` (Sep 9, 11:59 pm ET).
   This is a real fix any restore should include: convert to the user's timezone before taking the date.
3. **DBA tasks are labelled "EMBA".** The 3 existing DBA tasks carry `scheduling_context.source =
   'EMBA'`, because the sync labels everything that is not MIT as EMBA (§1). Harmless to placement;
   wrong in the UI ("📚 EMBA" badge in FocusView).

## C: what happens on a Nexus refresh, step by step, on real items

**The flag surface already exists (O), so nothing new is invented.** The flag reuses:
- **The Iris chat message + phone push.** It is a `public.scheduled_notifications` row with
  `notification_type = 'scheduled_chat'`, delivered by `notification-delivery` (main l.632-690 →
  `send-chat-message`, `sendPush: true`). The same row shape is written by the agent tool in
  `execute-tool` main l.2067-2130.
- **The task's own `scheduling_context` jsonb.** It already carries `origin: 'nexus-azure'` and
  `course_id` on the DBA tasks, and would hold a short change history so the card is traceable.
- **The owner's reply.** He answers in the Iris chat ("yes, update it"), and Iris applies it with the
  existing `update_task` tool (`execute-tool` main l.347). No new button or screen is needed.
- **One digest message per sync run, never one message per change.** This is the same rule the
  parked J2 nudge digest (`_shared/nudges.ts`, "ONE scheduled_chat digest per day") was built on.
  When J2 lands, this folds into that digest instead of sending its own.

**What the flag looks like (Iris chat, with a push "Iris: 2 course updates from Nexus"):**
```
Nexus refreshed your DBA courses overnight. 2 changes:
• MGT-782 Research Proposal — due date moved Fri Oct 30 → Tue Nov 3 (11:59 pm).
  [C-rec: I've updated the task.]   [C2: your task still says Oct 30. Want me to change it?]
• MGT-702 Checkpoint 2 - Details — Nexus now shows it as SUBMITTED.
  Your task is still open. Mark it done?
```

**A rule for both options:** the sync never reopens or changes a task the owner marked DONE. Today
the DBA "Introductions" task is DONE in journey while Nexus still says `active`. Neither option
touches it, and neither flags it.

### Example 1: a due date moves (Research Proposal, MGT-782; a hypothetical change on a real item)

Starting state: Nexus due Fri Oct 30, 11:59 pm. The journey task exists with the same due date, and
the nightly build has placed it in a Thu Oct 29, 7–9 pm slot. The instructor extends the deadline to
Tue Nov 3, and the owner's next Nexus course refresh picks that up.

| step | C-rec (auto-update due date/title, flag status) | C2 (flag everything, change nothing) |
|---|---|---|
| 1. nightly sync reads Nexus | sees due Nov 3 ≠ task Oct 30 | same |
| 2. task due date | **set to Tue Nov 3, 11:59 pm ET** | **stays Fri Oct 30** |
| 3. existing slot (Thu Oct 29) | still before the new deadline, so **kept**. A slot only moves when the new due date is EARLIER than the slot: then the slot is cleared (`is_scheduled=false`) and the nightly build re-places it | untouched |
| 4. trace | `scheduling_context.nexus_changes += {field:'due_date', from:'10-30', to:'11-03', at:<run>}` | same entry, marked `pending` |
| 5. flag | digest line, informational: "due date moved Oct 30 → Nov 3. I've updated the task." | digest line, a question: "…your task still says Oct 30. Want me to change it?" |
| 6. if the owner says nothing | task is correct (Nov 3) | task keeps the **wrong** date and the scheduler keeps planning against Oct 30. Re-flagged on every later run until answered (or once only; that is a sub-choice) |

**The opposite case, which is why C-rec moves the slot only when it must:** if the deadline moved
EARLIER, Oct 30 → Oct 28, the Thu Oct 29 slot would now fall after the deadline. Under C-rec the slot
is cleared and the next nightly build places the work before Oct 28. Under C2 the task keeps a slot
after its real deadline until the owner answers.

### Example 2: Nexus marks an item submitted (Checkpoint 2 - Details, MGT-702)

Starting state: the task is open, due Sun Nov 8. The owner submits on Canvas Nov 7, and the next
course refresh brings `status = submitted`.

| step | C-rec | C2 |
|---|---|---|
| 1. sync | sees `submitted`, task not DONE | same |
| 2. task | **unchanged** (still open) | unchanged |
| 3. flag | "Nexus now shows it as SUBMITTED. Mark it done?" | identical |
| 4. owner says yes | Iris runs `update_task` → DONE | identical |

**C-rec and C2 behave the same for status.** C-rec flags status changes on purpose: nothing should
leave the board without the owner seeing it, and Nexus status is not reliable for every course
(MGT-701 shows `active` on work he finished).

### Example 3: a title changes (Residency 4, MGT-782; hypothetical)

The instructor renames "Residency 4 - present ideas and insights from the readings" to "Residency 4
Presentation".

| | C-rec | C2 |
|---|---|---|
| task title | becomes `📚 Residency 4 Presentation`. The `📚` prefix is kept, the link (`assignment_id`) is unchanged, so no duplicate is created | stays the old title |
| flag | digest line, informational | digest line, a question |

### Something neither option can see (I, medium)

An item **removed** in Canvas. The Nexus refresh re-links and PATCHes rows; nothing I read in
`extension/background.js` deletes an assignment row, so the old row simply stays. Neither option gets
a removal signal. If the owner wants one, it has to come from Nexus (for example, rows missing from
the latest capture). That is not part of J7.

### The C choice in one line each
- **C-rec:** due date and title follow Nexus automatically, with an informational line in the daily
  Iris digest; a submitted/graded status is only flagged. The board stays current without action;
  the owner sees every change.
- **C2:** every change is a question in the daily Iris digest, and the task keeps the old value until
  he answers. Nothing changes without consent, but an unanswered flag leaves the scheduler planning
  against a stale deadline.
