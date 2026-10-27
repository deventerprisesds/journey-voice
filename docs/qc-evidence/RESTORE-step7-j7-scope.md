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
