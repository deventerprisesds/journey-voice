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
- **"Residency 4 - present ideas and insights from the readings" (Nov 9 per J7 scope doc, job 122439464760 on 10-27) is NOT in today's result** (filter: due ≥ now−35d, or undated and created in the last 120 d). Follow-up query dispatched to confirm whether it was deleted or re-dated — see §1d.
- `programs.is_active = t` for DBA, EMBA and MIT alike (O, same run) — consistent with the owner's 10-28 ruling that "current" = has open items dated today+, not a Nexus flag.

### 1d. Section 1 verdict
- **OBSERVED:** TaskOS main and live point at the **wrong store**: journey Supabase `public.assignments` (frozen 2026-04-06, EMBA/MIT) instead of Nexus `content.assignments` (live Canvas + manual DBA rows). The owner's hypothesis — *"not pointing to the correct tables in nexus from taskos"* — is confirmed, and is stronger than suspected: TaskOS points at **no** Nexus table at all.
- **OBSERVED:** consequently, **zero** of the 3 dated upcoming DBA deliverables (Research Proposal Oct 30, Checkpoint 2 Nov 8, Research Paper Dec 9) have ever been created as tasks by the sync.
- **INFERRED (high):** the 3 DBA tasks that do exist (Introductions, Residency participation, DB1 — all DONE; plus `origin:'nexus-azure'` EMBA-labelled ones) were created by the parked branch's Nexus sync during the window it was deployed (early Sep), then main's redeploy (10-19 / 10-26) put the Supabase reader back. See RESTORE §0.4.
