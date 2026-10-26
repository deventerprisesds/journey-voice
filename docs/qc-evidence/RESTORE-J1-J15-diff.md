# RESTORE J1–J15 — what main gained since the branch split, and what a naive restore would lose

WHAT: a per-feature before/after report for surgically restoring the parked journey-voice features J1–J15 onto current main. For each feature it shows exactly what main gained since the branch split, which a naive restore would LOSE.
WHY: owner 2026-10-20: "The j1-j15 updates should be surgical so that if there is anything that was added in the oct 15 overwrite that will be lost, i know what the difference will be before and after in case the oct 15 has things we need to keep rather than complete revert."
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: the shas and diffs cited inline; read-only `git fetch` of all refs on 2026-10-20 and 2026-10-21; `git merge-tree --write-tree` (read-only) results; live Supabase edge-function source (project wwxgajrtmslzklnyplah) read with get_edge_function on 2026-10-20; one read-only `SELECT` against the live DB catalog.
Feature definitions: `docs/qc-evidence/INVENTORY-parked-work.md` §1.

Labels: **O** = OBSERVED (read from git, the merge simulation or live source in this pass). **I** = INFERRED.

---

## 0. The shape of the problem (read this first)

| ref | sha | what it is |
|---|---|---|
| main | `aeef3d3` (2026-10-19) | what is deployed today (O: every edge function redeployed from it on 10-19) |
| xokgv1 (PR #26) | `150c027` (2026-09-14) | J1–J12 |
| nsishi (PR #17) | `d1059fe` (2026-10-08) | xokgv1 plus J13–J15 |
| merge-base(main, nsishi) | **`0459770`** (2026-10-08, "register the phone's FCM token on every app open") | the last point where the branch took main in (merge `3f07dcb`) |
| merge-base(main, xokgv1) | `724ff0a` (2026-09-21) | older; 4 more main commits sit between it and `0459770` (#16 alarm-sound test fix, FCM-on-open, two ledger commits) |

O: the branch merged main INTO itself repeatedly (merges `0b469b6`, `9f9429a`, `eb35a19`, `514ec55`, `1265824`, `87b2c5d`, `3f07dcb`), but main never took the branch. So **diff(`0459770` → branch) is exactly the parked feature work**, and **diff(`0459770` → main) is exactly what main gained since the split**. That second diff is the "Oct 15 overwrite" content the owner wants protected. It is 60 commits (O: `git rev-list --count 0459770..origin/main`) — #28–#61.

**Two restore methods, very different results:**

| method | what it does | effect on main's Oct 8–19 work |
|---|---|---|
| **NAIVE: take the branch's copy of a file** (`git checkout <branch> -- <file>`) | replaces the whole file with the September/October-8 branch version | **LOSES every main change in that file** (the tables below) |
| **SURGICAL: 3-way merge** (merge the branch, or cherry-pick feature commits, and resolve) | applies only the branch's own edits on top of main | keeps main's changes in every file that auto-merges; only the conflict hunks need a human choice |

O: a full read-only 3-way merge of nsishi onto main (`git merge-tree --write-tree origin/main origin/claude/mobile-widget-web-bridge-debug-nsishi`, result tree `72d3cd8`) **auto-merges everything except 13 files**, 3 of which are ledgers (`.claude/accuracy-log.md`, `actions.md`, `memory.md`). The same 13 for xokgv1 alone.

### 0.1 The 10 code files that conflict in a 3-way merge (O)

| file | hunks | whose work collides | which J feature is involved |
|---|---|---|---|
| `supabase/functions/nightly-schedule-builder/index.ts` | 2 | branch J1 trait layer (`resolveWindowPlan`) **vs** main #59 (keyword window first then category windows; categories stay in their own windows) | J1 (and J5/J8 sit beside it) |
| `supabase/functions/smart-calendar-scheduler/index.ts` | 1 | branch J1 trait layer **vs** main #31 (stop writing the category into `tasks.status`) | J1 |
| `src/services/schedulingService.ts` | 1 | branch's own "patch the stored config, never replace it" (8fe3dc4, J8 lane) **vs** main #59's `mergeStoredConfig`. Two independent fixes of the same 09-13 settings-wipe bug | J8 (config save) |
| `package.json` | 1 | branch `test: node scripts/run-tests.mjs` + `check:symbols` **vs** main adding `cloudflare/src/*.test.ts` to `test` | J12 |
| `scripts/assert-ref-contains-main.sh` | 0 text hunks (add/add) | **same content on both sides**; only the file mode differs (branch 755, main 644). Main got this file in #55 and uses it in `deploy-cloudflare.yml` only | J12 |
| `cloudflare/src/notify.ts`, `notify.test.ts` | 4 + 1 | September notify/Slack Worker work, which main re-landed in a newer form in #46–#57 | **not J1–J15** (Inventory: not parked) |
| `supabase/functions/notification-delivery/index.ts` | 4 | branch's September briefing renderer (`_shared/notification-body.ts`) **vs** main's Oct 15 HTML briefing (`notification-delivery/notification-body.ts`, `iris-window.ts`, meetings + next 7 days) | not J1–J15 (J13's alarm hunks in this file auto-merge) |
| `supabase/functions/send-unified-notification/index.ts` | 5 | September notify lane **vs** main #46 (authenticated email sender) and #55 (HTML email) | not J1–J15 |
| `src/utils/notificationChannels.test.ts` | 1 | same notify overlap (#44/#55 vs branch c529ff3/6cd8bbf) | not J1–J15 |

**Consequence (I, high confidence):** the J1–J15 restore should NOT bring the September notify/Slack/briefing commits (`2f04b88`…`6cd8bbf`, `fb80729`, `c529ff3`). Main already has newer versions of that work and they are live. Leaving them out removes 5 of the 10 code conflicts.

### 0.2 Every file BOTH sides changed since `0459770`, and what main changed in it (O)

This table is the core of the answer: **these are the main changes a "take the branch's file" restore would delete.**

| file | main's changes since the split (plain words) | main PR(s) | auto-merges? | J feature(s) that touch it |
|---|---|---|---|---|
| `supabase/functions/nightly-schedule-builder/index.ts` | (+7/−22) the local `getPreferredWindows` moved to `_shared`; a category is placed ONLY in the windows it lists (no fallback to every window); a keyword window now LEADS the category windows instead of replacing them | #59 (c11b1a2, 10-18) | **NO (2 hunks)** | J1, J2, J4, J5, J7, J8 |
| `supabase/functions/_shared/scheduling-defaults.ts` | (+41) new shared `getPreferredWindows()` (categories stay in listed windows) and `withKeywordWindow()` | #59 | yes | J1, J2, J8 |
| `src/services/schedulingService.ts` | (+16/−1) a settings save MERGES into the stored config (reads it first, refuses to save if the read fails) — fixes the 09-13 wipe of the owner's windows/categories/keywords | #59 | **NO (1 hunk)** | J5/J8 (8fe3dc4) |
| `src/config/schedulingRules.ts` | (+4/−1) a removed keyword stays removed: the stored keyword list replaces the 48 defaults instead of being merged under them (`resolveKeywords`) | #61 (4fadd05, 10-19) | yes | J1, J5, J8 |
| `supabase/functions/smart-calendar-scheduler/index.ts` | (+11/−1) stops reading `mapping.defaultStatus` — it was writing a CATEGORY ('CAREER', 'EDUCATION'…) into `tasks.status` | #31 (99289a4, 10-08) | **NO (1 hunk)** | J1, J8 |
| `supabase/functions/execute-tool/index.ts` | (+71) new `get_task_topics` tool (topic tree + task links, used by Huddle's priorities widget, with `created_at`/`updated_at`); default-board lookups take the OLDEST board (`order created_at asc`) in `createTask` and `parseAndCreateTasks` | #42/#47/#52, #43 | yes | J1, J4, J6, J7, J8 |
| `supabase/functions/nightly-assignment-sync/index.ts` | (+1) oldest default board | #43 (ec65855) | yes | J7 |
| `src/utils/assignmentSync.ts` | (+4) oldest default board, `limit(1)` (stopped a duplicate-board runaway: 28 empty boards cleaned in #41) | #43 | yes | J7 |
| `src/utils/assignmentFetching.ts` | (+14/−3) three `status: 'PROF_EDUCATION'` (a category) → `'BACKLOG'`, plus a note | #33 (751904b) | yes | J7 |
| `src/components/TaskCreationModal.tsx` | (+9/−19) `mapCategoryToStatus()` deleted; new tasks get `UP_NEXT` if dated, else `BACKLOG`; imported assignments likewise (was `status: 'PROF_EDUCATION'`). (The LIFE→"Personal" rename #35 was added then reverted #40 — net zero.) | #28 (fba5a34), #35/#40 | yes | J7 |
| `package.json` | `test` also runs `cloudflare/src/*.test.ts` | #55 | **NO** | J12 |
| `scripts/assert-ref-contains-main.sh` | added (identical text to the branch's) | #55 | add/add, mode only | J12 |
| `.github/workflows/deploy-cloudflare.yml`, `cloudflare/*` | Worker brought in line with live (`/notify`, Slack events) | #55 | identical / notify conflicts | not J |
| `notification-delivery/index.ts`, `send-unified-notification/index.ts`, `notificationChannels.test.ts` | HTML briefing email, meetings section, rest-of-today + next-7-days, Iris window message, authenticated email sender | #44, #46, #49, #50, #53, #55, #57 | NO | J13 touches notification-delivery (its hunks auto-merge) |

O, the category-into-status defect is the single biggest naive-restore hazard: the branch's copies of `TaskCreationModal.tsx` (lines 621, 676, 944), `assignmentFetching.ts` (lines 50, 132, 170) and `smart-calendar-scheduler/index.ts` (line 497, `suggestedStatus = …defaultStatus`) still contain it, because the branch forked before #28/#31/#33. Taking those files whole **reinstates the bug that put tasks into the wrong board lane** (main ledger: "status is a workflow state, not the category").

### 0.3 Main-only work since the split in files the features do NOT touch (safe either way)

`src/utils/workflowStatus.ts` (#28), `mergeStoredConfig.ts` (#59), `resolveKeywords.ts` (#61), `boardLookup.test.ts`/`KanbanBoard.tsx`/`Calendar.tsx`/… (#43), `NotificationSettings.tsx` + alarm sound file (#54), `ai-task-parser` (#28/#29), `RealtimeVoiceAssistant.ts` (#33/#43), `notification-delivery/notification-body.ts` + `iris-window.ts` (#50–#60, incl. "Sent by TaskOS" #60), migration `20261015180000_schedule_next_call_dedupe.sql` (one email instead of three), `.github/workflows/parse-edge-functions.yml` (bundle-parse guard on PRs). O: no J commit edits these paths, so nothing here can be overwritten — BUT see the semantic notes per feature (e.g. J1 code calls the OLD `getPreferredWindows` semantics).

### 0.4 What is running live now (O, read 2026-10-20)

Byte-identical to **main** (0 differing lines), so none of the branch's function code is live:
`nightly-schedule-builder` v301, `execute-tool` v503 (+ `_shared/tool-definitions.ts`), `notification-scheduler` v581, `classify-task-topic` v306, `batch-calendar-scheduler` v491, `smart-calendar-scheduler` v572, `notification-delivery` v591 (incl. `notification-body.ts`, `iris-window.ts`), `_shared/scheduling-defaults.ts` as bundled. `manage-push-subscription` v586 matches main (no `source` field, no dedupe). `send-push-notification` v586: no `actionToken` mint (Inventory, O). `nightly-assignment-sync` v246 = main (Inventory, O).
Still deployed but orphaned (not on main): `confirm-external-meeting` v125 (2026-08-29), `alarm-action` v36 (2026-10-08).
DB objects from the branch that ARE live (O, `SELECT` on catalog): cron jobs `maint-http-response-vacuum` (*/15), `maint-cron-history-prune`, `maint-cron-history-vacuum`, `maint-weekly-vacuum-full`; trigger `preserve_task_provenance_trigger` on `tasks`; functions `preserve_task_provenance()`, `schedule_task_reminders()`; tables `task_overflow_queue`, `external_event_attendance`, `task_dedup_log`.

### 0.5 Per-commit cherry-pick simulation (O, with a caveat)

Each branch code commit was simulated onto main alone (`git merge-tree --write-tree --merge-base=<c>^ origin/main <c>`). Most "conflict" — but mainly because each commit depends on EARLIER branch commits that main never got, not because of main's new work. So cherry-picking one feature's commits in isolation is NOT easier than a 3-way merge; the features are interleaved in the same files (`nightly-schedule-builder` is edited by J1, J2, J4, J5, J7, J8). Clean-in-isolation (rc=0) commits: `849f956` (J1 batch prompt), `28bc22b` (J3 core), `d113cc6`/`8d70611`/`ce1cd3a`/`fdf1180`/`efad832` (J4 dryRun), `6024b0b` (J12 shadow run), `1eda8f2` (J11), `e45d30a` (J7 nightly sync), `2316dec` (J9), `aecf460`/`250c3b1` (J13), `3f2e786` (J12 drift check), `f36c1d6` (J16).

---
(Per-feature sections follow, appended as each is completed.)

## J1 — Scheduler de-fork, trait layer, weekend-evening protection, pinned appointments, capacity guard

**Commits (O):** `8231f14` (de-fork smart scheduler onto shared config), `bc22f3a` (execute-tool `find_open_slots` uses the shared windows), `aa23eea` (after_work 17–19; reconcile copies), `6825684` (keyword rules on the voice path + priority multipliers), `849f956` (custom AI instructions into the batch placer), `a1ffd16`/`877679e`/`89bb11b`/`06901c7` (trait layer, keyword table demoted to a LOUD fallback, LLM trait classification), `9d122f7` (weekend-evening protection), `2813f5c` (booked appointments pinned), `dc15925` → `32aaa71` (`maxDailyHours` guard, later made opt-in), `b229ec7` (venue nudge in the morning review — shared with J2), docs `7eae8c2`/`101464e` (CLAUDE.md).
**Files:** `smart-calendar-scheduler/index.ts` (+213/−128 cumulative branch diff), `_shared/scheduling-defaults.ts` (+413, shared with J2/J8), `nightly-schedule-builder/index.ts` (+789/−137, shared with J2/J4/J5/J7/J8), `batch-calendar-scheduler/index.ts` (+210/−17, shared with J4/J5/J8), `execute-tool/index.ts` (bc22f3a: 6/−9), `src/config/schedulingRules.ts`, `src/utils/buildDayContext.ts` + `_shared/build-day-context.ts` (+28 each), `CLAUDE.md`.

**What main changed in those files since the split (O, = what a naive restore loses):**
- `nightly-schedule-builder` + `_shared/scheduling-defaults.ts` — **#59 (10-18)**: (a) a category is placed only in the windows it lists — the old "if none of its windows are open today, use every window" fallback is gone (owner, quoted in the code: *"we will move ventures to weekends"*); (b) a keyword window now goes FIRST and the category's windows follow, so a full keyword window relaxes instead of leaving the task unplaced.
- `smart-calendar-scheduler` — **#31 (10-08)**: stopped copying `mapping.defaultStatus` (a category name) into `suggestedStatus`, which was writing 'CAREER'/'EDUCATION' into `tasks.status`.
- `schedulingRules.ts` — **#61 (10-19)**: a keyword the owner removes stays removed.
- `execute-tool` — **#42/#47/#52** `get_task_topics`; **#43** oldest-board lookups.

**Conflicts in a 3-way merge (O):** `nightly-schedule-builder` (2 hunks: the import list, and the window-choice block where branch's `resolveWindowPlan(...)` meets main's `withKeywordWindow(...)`); `smart-calendar-scheduler` (1 hunk at ~line 494: branch's trait block re-adds `suggestedStatus = config.categoryMappings[taskCategory].defaultStatus`, main's side removes it). `execute-tool`, `scheduling-defaults`, `schedulingRules`, `batch-calendar-scheduler` auto-merge.

**Semantic overlap the merge will NOT flag (O from reading both sides; consequence I):**
1. The branch's `resolveWindowPlan` (keyword → `[kw.window, ...catWindows]`) already does what #59's `withKeywordWindow` does. Keep ONE: the branch's version inside the trait layer, since it also carries trait precedence. Do not stack both.
2. In the merged file, main's deletion of the builder's local `getPreferredWindows` wins (O: the merged tree has no local definition), so the branch's three call sites (branch lines 946, 1581, 2178) will call main's shared version. That is the behaviour the owner chose on 10-18 (no spill into every window), but it changes the branch's own fallback `if (preferredWindows.length === 0) preferredWindows = getPreferredWindows(...)`: a weekend-only category on a weekday now gets `[]` and is not placed that day. This is what #59 intends. Re-verify with the dryRun harness (J4) after restore.
3. `aa23eea` changes the CODE DEFAULT for `after_work` to 17–19. The owner's stored config (restored in #59/#61's session, ACT:scheduling-config-restore) overrides defaults, so it matters only for windows he has not set (I).

| Today (main) does | After surgical restore also does | Lost if done naively (take branch files) | Recommended handling |
|---|---|---|---|
| Places each category only in its listed windows; a keyword window leads, then the category windows; removed keywords stay removed; never writes a category into status | Classifies traits (appointment / venue-dependent / impact) with an LLM pass plus a deterministic floor; booked appointments are pinned and immovable; protects weekend evenings; keyword table is a loud fallback; optional `maxDailyHours` guard; one shared window config for all three placers | #59 window rules, #61 keyword rule (only via schedulingRules if the whole file is taken), **#31 status fix (re-breaks board lanes)**, #42/#47/#52 `get_task_topics` and #43 oldest-board (if execute-tool is taken whole) | 3-way merge. In the builder hunk, take the branch's `resolveWindowPlan` block and keep main's import of the shared `getPreferredWindows`. In the smart-scheduler hunk, take the branch's trait block **minus** the `suggestedStatus = …defaultStatus` line (keep main's comment). |

**Live now (O):** `nightly-schedule-builder` v301, `smart-calendar-scheduler` v572, `batch-calendar-scheduler` v491, `execute-tool` v503 are all byte-identical to main. None of J1 is running.

## J2 — Value-aware overflow queue + one morning nudge digest

**Commits (O):** `6bdb2d8` (overflow queue + `classifyImpact` + Daily Review card + migration `20260726000000_task_overflow_queue.sql`), `b229ec7` (venue nudge in the morning review; `buildDayContext` ×2), `826d310` (`_shared/nudges.ts` 218 lines: queue ONE `scheduled_chat` digest per day; fixed the "scheduled after work" message that claimed a placement regardless), later expanded in `8fe3dc4`/`bf38ea7` (`nudges.ts` → 405 lines, `nudges.test.ts` 375 lines).
**Files:** `_shared/nudges.ts` + test (new, main has no file there), `nightly-schedule-builder/index.ts`, `_shared/scheduling-defaults.ts`, `src/components/DailyReviewModal.tsx` (+165, all J1/J2/J3), `src/utils/buildDayContext.ts`, `_shared/build-day-context.ts`, migration.

**What main changed in those files since the split (O):** builder and scheduling-defaults — #59 (see J1). `DailyReviewModal.tsx`, `buildDayContext.ts` ×2, `nudges.ts` — **nothing** (0 commits on main since `0459770`), so taking the branch's copies of those loses nothing.
**Conflicts (O):** none of J2's own hunks. The builder conflicts belong to J1.
**Interaction with main's new work (O read; consequence I):** J2 delivers through the existing `scheduled_chat` path. Main's `notification-delivery` still handles `scheduled_chat` (O: main lines 143, 632), so the delivery route J2 relies on is intact. Main ALSO added #57/#58: at each window call (8am Morning Kickstart included) journey asks Huddle for an Iris message. After restore the owner would get, around 8am, **both** the J2 nudge digest (an Iris chat message, default 8am local) **and** the #57 Iris morning message. They come from different sources, so there is no dedupe between them. Decide whether the nudge digest should be folded into the #57 morning message or kept as a separate message.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Overflowed tasks just aren't placed; no nudge is sent; 8am Iris window message via Huddle (#57) | High-impact overflow goes to `task_overflow_queue` and gets bumped; venue + overflow nudges arrive as ONE Iris chat digest a day; Daily Review shows them | nothing in J2-only files; the #59 builder rules if the builder is taken whole | 3-way merge (builder) + take the branch's copy of `nudges.ts`, `DailyReviewModal.tsx` and `buildDayContext` ×2. Owner decides whether the digest merges into #57's 8am message. |

**Live now (O):** the table `task_overflow_queue` exists live. The code that writes and delivers it is not live (the builder is main's).

## J3 — External-meeting confirmation + slot release

**Commits (O):** `28bc22b` (new `confirm-external-meeting` edge fn, 177 lines, + migration `20260726010000_external_event_attendance.sql`), `1719657` (Daily Review asks "are you attending?").
**Files:** `supabase/functions/confirm-external-meeting/index.ts` (branch-only), migration (branch-only), `src/components/DailyReviewModal.tsx` (shared with J1/J2; main untouched).
**What the function does (O, read):** records attending/declined/no-show in `external_event_attendance`. On decline it reads `external_calendar_events`, finds the next unscheduled task of the meeting's category that fits, and writes that task's time into the freed slot (`tasks` update).
**What main changed in those files since the split (O):** nothing. Main has no `confirm-external-meeting` and no `external_event_attendance` reference in code or migrations.
**Conflicts (O):** none. `28bc22b` cherry-picks cleanly onto main by itself (rc=0). `1719657` conflicts only because it depends on the earlier J2 hunks in `DailyReviewModal.tsx`.
**Interaction (I):** main's Oct 15 briefing email reads the same `external_calendar_events` table (#44/#49/#50), so a declined meeting will still show in the email as a meeting. J3 does not delete the event row. Harmless, but the two views can disagree.
**Deploy note (O, main memory.md line 558):** `DailyReviewModal.tsx` is web-client code, and *"journey's CLIENT does NOT deploy from GitHub Actions — it is a LOVABLE app"*. The prompt reaches the owner only once Lovable builds from main.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Meetings show in the briefing; nothing asks whether you'll attend; the orphan `confirm-external-meeting` v125 is deployed, but nothing calls it | Morning review asks about each external meeting; a decline fills the freed slot with a fitting task | nothing (no main changes in J3 files) | Take the branch's function + migration file as-is (the table is already live); bring the `DailyReviewModal` hunks with J2. Redeploying the fn from main replaces v125 with the same code (I: v125 dates 08-29, after 1719657). |

**Live now (O):** `confirm-external-meeting` v125 is deployed (2026-08-29) and the table `external_event_attendance` is live. The UI that calls the function is not on main, so it is unreachable.

## J4 — dryRun harness (builder + "Add a task for today") and slotter repairs

**Commits (O):** `1697014`, `d113cc6` (builder `dryRun`: the full real pipeline including the AI slotter, with zero writes; 71 `dryRun` mentions in the branch builder), `8d70611` (`dryRun` for `parse_and_create_tasks` in execute-tool), `ce1cd3a` (pass in-run busy slots into `batch-calendar-scheduler` so a dry run is faithful), `fdf1180` (reject AI slots with a missing or invalid time instead of coercing them to 1970), `f13d7f7` (repair out-of-window AI slots instead of dropping them; deploy "all" mode), `efad832` (**TEMPORARY** `slotter_trace` row written to `activity_log` on every slotter call — O: still present at branch line 902). Net zero: `4ef7b8c` + `0d9bb68` (conflict-aware apply) were reverted on the branch itself by `a0dc8ec` + `f42043e`.
**Files:** `nightly-schedule-builder/index.ts`, `execute-tool/index.ts`, `batch-calendar-scheduler/index.ts`, `.github/workflows/deploy-supabase-functions.yml`.

**What main changed in those files since the split (O):** builder — #59 (J1). execute-tool — #42/#47/#52 `get_task_topics`, #43 oldest board **inside `parseAndCreateTasks` itself** (the same function J4 edits). batch-calendar-scheduler, deploy-supabase-functions.yml — nothing.
**Conflicts (O):** none in J4's own hunks. In the read-only merged tree, `parseAndCreateTasks` holds BOTH main's `.order('created_at', { ascending: true })` (merged line 1416) and the branch's `const dryRun = args.dryRun === true` (line 1399), and the dispatcher holds both `case 'get_task_topics'` (main) and `case 'undo_dedup'` (J6). The 3-way merge keeps both sides here; taking the branch file whole would drop main's two.
**Semantic note (O):** main already writes a new task's status as `task.status || args.default_status || (dated ? 'UP_NEXT' : 'BACKLOG')` (main execute-tool line 1489), and the branch kept that line. No status regression from J4.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| No way to preview the nightly build; AI slots with a bad time are coerced/dropped | Zero-write dry runs of the nightly build and of "Add a task for today"; bad AI times rejected; out-of-window slots repaired | `get_task_topics` (Huddle priorities widget), oldest-board fix | 3-way merge. **Drop `efad832`** (or its trace block) — it is marked TEMPORARY and writes one `activity_log` row per slotter call. |

**Live now (O):** builder v301, execute-tool v503 and batch-calendar-scheduler v491 equal main, so dryRun is not live.

## J5 — Composite scoring model (switchable, then default) + category maxPerDay + overdue escalation + priorityBoost

**Commits (O):** `925d9df` (switchable composite scoring in the builder), `c5de8f4` (enforce category `maxPerDay` in builder + batch placer; composite overdue escalation), `5445bc2` (Settings toggle composite ⇄ priority-rank: `SchedulingSettings.tsx`, `schedulingRules.ts`, builder), `055e8ca` (composite becomes the default), `bf347d4` (`config.priorityBoost` toggle that turns off `is_priority` score privileges).
**Files:** `nightly-schedule-builder/index.ts`, `batch-calendar-scheduler/index.ts`, `src/components/SchedulingSettings.tsx` (+276/−5 cumulative, shared with J8), `src/config/schedulingRules.ts` (+251/−24 cumulative, shared with J1/J8).

**What main changed in those files since the split (O):** builder — #59. `schedulingRules.ts` — #61 (`resolveKeywords`, one line + import). `SchedulingSettings.tsx`, `batch-calendar-scheduler` — nothing.
**Conflicts (O):** none of J5's own hunks in the full merge. `schedulingRules.ts` auto-merges, so #61's keyword rule survives a 3-way merge. If `schedulingRules.ts` were taken from the branch, **#61 is lost**: removed keywords (bill/business/project/startup, which the owner removed on 10-19) would reappear on screen and be written back on the next Save.
**Today's behaviour (O by grep):** on main, `maxPerDay` is enforced only in `smart-calendar-scheduler` (main lines 648–658). The nightly builder, which places the day, uses the constant `MAX_ASSIGNMENTS_PER_DAY` (= 2) and never reads `maxPerDay`. `scoringModel` and `priorityBoost` have 0 hits on main.
**Interaction with the 10-19 settings restore (O, main actions.md `ACT:scheduling-config-restore`):** the owner's restored row has `PROF_EDUCATION … maxPerDay 2`. After J5 the builder will actually ENFORCE that 2/day, which the Settings screen already promises. The restored row has no `scoringModel` key, so J5's default applies: **composite** (`055e8ca`). That is a scoring change from today's priority-rank order and should be stated to the owner (I).

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Nightly builder ranks by priority rank; category `maxPerDay` is ignored by the builder (honoured only by the advisory smart scheduler) | Composite scoring by default, switchable in Settings; builder and batch placer enforce each category's `maxPerDay`; recent overdue tasks escalate; `is_priority` boost can be switched off | #61 removed-keywords rule (if `schedulingRules.ts` is taken whole); #59 (if builder taken whole) | 3-way merge. Take the branch's `SchedulingSettings.tsx` (main never changed it). Tell the owner the default flips to composite, or ship it with `scoringModel` defaulting to priority-rank until he chooses. |

**Live now (O):** none of J5 is live (builder v301 = main; `scoringModel` 0 hits live per Inventory).

## J6 — Task dedup guard + `undo_dedup`

**Commits (O):** `22f145b` (creation-time dedup guard, flag-gated: `_shared/task-dedup.ts` 371 lines + `task-dedup.test.ts` 132 lines + migration `20260220000000_task_dedup_log.sql` + execute-tool +84/−5), `0800e59` (dedup notice sent as an Iris `scheduled_chat` message; `undo_dedup` tool in execute-tool + `_shared/tool-definitions.ts` +13), `895f02c` (notice copy polish).
**Files:** `_shared/task-dedup.ts` + test (branch-only), migration (branch-only), `execute-tool/index.ts` (`createTask` and `parseAndCreateTasks` call `runDedup`; new `case 'undo_dedup'` and `undoDedup()`), `_shared/tool-definitions.ts`.

**What main changed in those files since the split (O):** `execute-tool` — #42/#47/#52 `get_task_topics`; #43 oldest-board lookups inside `createTask` and `parseAndCreateTasks` (the two functions J6 edits). `tool-definitions.ts`, `task-dedup.ts` — nothing (0 main commits since `0459770`).
**Conflicts (O):** none. In the read-only merged tree (`72d3cd8`) execute-tool holds main's oldest-board `.order('created_at', { ascending: true })` (merged lines 879 and 1416) right beside the branch's `runDedup(...)` calls (lines 896 and 1488), and the dispatcher holds both `case 'undo_dedup'` (374) and `case 'get_task_topics'` (427).

**Semantic notes (O from code and a live read-only `SELECT`; consequences I):**
1. **The guard will be OFF after restore.** `resolveDedupConfig` reads `user_scheduling_prefs.config.dedup.enabled` and treats anything but `true` as off (branch `task-dedup.ts` line 73). Live (O, 2026-10-26): **no** `user_scheduling_prefs` row has a `dedup` key. The owner's row (updated 2026-10-19 16:27) has only `caveats, timezone, timeWindows, contextRules, workingHours, workloadBalance, categoryMappings, customAIInstructions`. The 09-13 config wipe (main `mergeStoredConfig.ts` header) most likely deleted `dedup.enabled`, and the 10-19 restore did not put it back (I). So restoring the code alone changes nothing. The owner has to re-enable it, and since #59, a Settings save merges, so the key will then survive later saves (O: `mergeStoredConfig` keeps every key the page did not send).
2. **`undo_dedup` would bring back the category-in-status bug for old rows.** `undoDedup` re-inserts the saved `candidate` payload as-is (only `id` is removed). Live `task_dedup_log` has 6 rows, the newest 2026-08-25. The 4 `skipped` rows that are not yet undone carry `status` = `'VENTURES'` (×2) and `'LIFE'` (×2): category names, written before #28/#31. Undoing any of them would insert a task into a lane that does not exist. Fix it before or with the restore: undo should re-derive `status` the way main does (`dated ? 'UP_NEXT' : 'BACKLOG'`), or those 4 rows' `candidate.status` should be corrected. All 6 rows point at a board that still exists (O).
3. Semantic matching calls OpenAI `text-embedding-3-small` using the existing `OPENAI_API_KEY` (O, line 91–99). That adds one embeddings call per task creation, but only while the guard is enabled.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Creates every task it is asked to, duplicates included; `task_dedup_log` exists but nothing writes it; Huddle priorities widget uses `get_task_topics` | (once `dedup.enabled` is set) skips exact/near duplicates, flags possible ones `possible-duplicate`, tells the owner in one Iris chat message, and "undo" / "add it back" restores a skip | `get_task_topics` and the oldest-board fix in `createTask`/`parseAndCreateTasks` (if execute-tool is taken whole) | 3-way merge for execute-tool. Take the branch's `task-dedup.ts`, test and `tool-definitions.ts` (main never changed them). Patch `undoDedup` to recompute `status`. Re-enable the flag in the owner's config only after he says so; the original approval was "notify me on every dedup so I can review/undo". |

**Live now (O):** `execute-tool` v503 (2026-10-19), byte-identical to main (Inventory, O), so it has no dedup and no `undo_dedup`. Table `task_dedup_log` is live (6 rows, last 2026-08-25).

## J7 — Assignments read from Nexus (Azure) everywhere

**Commits (O):** `e45d30a` (nightly-assignment-sync reads Nexus, scoped to the active MIT course: +150/−15), `225a3a7` (web Task modal, Assignments page, `assignmentFetching`/`assignmentSync`, execute-tool and the nightly sync all read Nexus; new `src/utils/nexusAssignments.ts` 132 lines and `_shared/nexus.ts` 135 lines), `0969b9d` (`list_pending_assignments` scoped to active courses + coursework order; `nexus.ts` +162), `06b0eba` (`sync-google-sheets` and `sync-mit-sheets` write to Nexus; the builder shares the coursework order; deploy workflow syncs `UAT_BYPASS_TOKEN`; `scripts/undef-check.mjs`).
**Files:** `nightly-assignment-sync/index.ts`, `src/components/TaskCreationModal.tsx`, `src/pages/Assignments.tsx`, `src/utils/assignmentFetching.ts`, `src/utils/assignmentSync.ts`, `src/utils/nexusAssignments.ts` (new), `_shared/nexus.ts` (new), `execute-tool/index.ts`, `nightly-schedule-builder/index.ts`, `sync-google-sheets/index.ts`, `sync-mit-sheets/index.ts`, `.github/workflows/deploy-supabase-functions.yml`, `scripts/undef-check.mjs`.

**What main changed in those files since the split (O, `git log 0459770..origin/main -- <file>`):**
- `TaskCreationModal.tsx` — `fba5a34` (#28: `mapCategoryToStatus()` deleted; dated → `UP_NEXT`, else `BACKLOG`; imported assignment no longer `status: 'PROF_EDUCATION'`), `aff9ff3`/`2a8bd13` (#35 LIFE→"Personal" rename and its #40 revert, net zero).
- `assignmentFetching.ts` — `751904b` (#33: three `status: 'PROF_EDUCATION'` → `'BACKLOG'`).
- `assignmentSync.ts`, `nightly-assignment-sync` — `ec65855` (#43: oldest default board, `limit(1)`).
- `execute-tool` — #42/#47/#52, #43 (see J6). `nightly-schedule-builder` — #59 (see J1).
- `Assignments.tsx`, `sync-google-sheets`, `sync-mit-sheets`, `deploy-supabase-functions.yml`, `undef-check.mjs`, `nexusAssignments.ts`, `nexus.ts` — nothing.

**Conflicts (O):** none of J7's own hunks. In the merged tree (`72d3cd8`) main's fixes survive next to the Nexus code: `TaskCreationModal.tsx` merged line 882 `status: 'BACKLOG'` and line 932 holds main's "Was `status: 'PROF_EDUCATION'`" note; `assignmentFetching.ts` lines 61/143/181 read `status: 'BACKLOG'`; `assignmentSync.ts` lines 41–42 and 160–161 and `nightly-assignment-sync` lines 63–64 hold the oldest-board `order … ascending: true` + `limit(1)`. The builder's J7 lines (`courseworkOrder`, merged line 32/869) are outside both builder conflict hunks.

**Semantic notes (O from code; consequence I):**
1. **The category-in-status hazard is worst here.** The branch's copies of `TaskCreationModal.tsx` and `assignmentFetching.ts` still have the `PROF_EDUCATION`-as-status lines (section 0.2). J7 rewrote these two files, so they are the files someone is most tempted to take whole. **Taking either file from the branch reinstates the board-lane bug.**
2. **New runtime dependency.** Reads go to `NEXUS_API_URL` (default `https://nexus-hub-api.azurewebsites.net`, `nexus.ts` line 35–36; client `VITE_NEXUS_API_URL`, `nexusAssignments.ts` line 31) with no auth header (O). Writes (the sheet syncs) need the edge secret `UAT_BYPASS_TOKEN`. The branch's own comment (nexus.ts ~line 91) says: *"a token named for UAT, now load-bearing in a production write path. It grants write access to ANY owner…"*. Main's deploy workflow has no step that syncs `UAT_BYPASS_TOKEN` (O: only `JOURNEY_PROXY_TOKEN`), so the J7 workflow hunk must come with it. Without the token the syncs refuse to write and say so (O, `nexusRequest`). Whether the secret is still set in edge secrets: not checked (no MCP tool lists secret names).
3. Main still reads the frozen Supabase `public.assignments` snapshot (O: main `nightly-assignment-sync` line 116 `.from('assignments')`). The Inventory records its newest row as 2026-04-06.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Nightly sync, `list_pending_assignments`, the Assignments page and the Task modal read the frozen Supabase `assignments` table (newest row 2026-04-06); imported assignments land in `BACKLOG`/`UP_NEXT`; oldest default board | All of those read the live MIT course from Nexus (Azure); sheet syncs write to Nexus; coursework is ordered by deadline (shared with the builder) | **#28/#33 status fix (re-breaks board lanes)** if `TaskCreationModal.tsx` or `assignmentFetching.ts` is taken whole; **#43 oldest-board + `limit(1)`** (the duplicate-board runaway fix) if `assignmentSync.ts` or `nightly-assignment-sync` is taken whole; `get_task_topics` if execute-tool is taken whole | 3-way merge for all six shared files. Take the branch's new files (`nexus.ts`, `nexusAssignments.ts`) and the unchanged-on-main ones (`Assignments.tsx`, both sheet syncs, the deploy-workflow step). Confirm `UAT_BYPASS_TOKEN` is set before the sheet syncs deploy. Client files ship only through Lovable (section J3 deploy note). |

**Live now (O):** `nightly-assignment-sync` v246, `execute-tool` v503, `sync-google-sheets` v757, `sync-mit-sheets` v496, all deployed 2026-10-19 16:39 from main. Per the Inventory (O), live v246 makes no Nexus calls. I did not diff the two sheet-sync functions' live source this pass.

## J8 — One weekend-aware, config-driven per-day assignment cap + deadline-triage / recent-miss ordering (+ the branch's config-save fix)

**Commits (O):** `dce9f92` (one `resolveCategoryDailyCap()` used by the builder, batch placer and smart scheduler; weekend-aware; deadline-triage order; Settings fields), `2a1883f` (swap bands 2 and 3: a recent miss outranks far-future work), `dce1fbb` ("the N most recent misses always lead the coursework queue": `resolveRecentCutoff`, Settings + `schedulingRules.ts`, execute-tool, builder), and `8fe3dc4`. That last one is titled **"wip: four-lane implementation snapshot — NOT verified, NOT deployed"** (2026-09-03). It adds `_shared/assignment-cadence.ts` + test (infers a missing `due_date` from the course's weekly cadence), the nudges expansion (J2), and **Lane C: patch-semantics config save** in `src/services/schedulingService.ts`.
**Files:** `_shared/scheduling-defaults.ts`, `nightly-schedule-builder`, `batch-calendar-scheduler`, `smart-calendar-scheduler`, `execute-tool`, `_shared/nexus.ts` + test (J7's file), `_shared/assignment-cadence.ts` + test (branch-only), `nightly-assignment-sync`, `src/components/SchedulingSettings.tsx`, `src/config/schedulingRules.ts`, `src/services/schedulingService.ts`.

**What main changed in those files since the split (O):** `scheduling-defaults.ts` + builder — #59. `smart-calendar-scheduler` — #31. `schedulingRules.ts` — #61. `schedulingService.ts` — #59 (`mergeStoredConfig` + "refuse if the read fails"). `execute-tool` — #42/#47/#52, #43. `nightly-assignment-sync` — #43. `batch-calendar-scheduler`, `SchedulingSettings.tsx`, `nexus.ts`, `assignment-cadence.ts` — nothing.

**Conflicts (O):**
- `src/services/schedulingService.ts`, 1 hunk (merged tree `72d3cd8`, lines 297–300). Main's side is a single line inside `updateData`: `config: mergeStoredConfig(storedRow?.config, restConfig …)`. The branch's side is EMPTY, because the branch builds `updateData.config` further down (merged lines ~303–329): it reads the stored JSONB (`loadStoredSchedulingConfigRaw`), applies only keys that are present, honours `options.removeConfigKeys`, refuses to save when the read fails, and leaves `config` out of the write entirely for callers that only touch dedicated columns (`{timezone}`, `{ceremony_schedule}`).
- Both sides fix the same bug. **Either resolution saves correctly** (I, from reading both): with main's line kept, the branch's block overwrites `updateData.config` whenever there are patch entries, and otherwise main writes `merge(stored, {})` = stored. Keeping both costs one extra DB read per save. Recommended: take the branch side (it adds `removeConfigKeys` and the column-only path) and drop main's now-redundant `storedRow` read. Keep main's `mergeStoredConfig.ts` + test, which other code may import (I). Never leave the hunk empty AND delete main's read guard together without the branch block, or saves go back to the wipe.
- All other J8 hunks auto-merge. The merged tree wires `resolveCategoryDailyCap` into the smart scheduler (merged lines 15/719/812), the batch placer (5/777) and the builder (25/1537/2136), `resolveRecentCutoff` into the builder (864) and execute-tool (2914), and `inferMissingDueDatesByCourse` into `nightly-assignment-sync` (10/228).

**Semantic notes (O; consequences I):**
1. **History that matters for the owner.** The commit main names as the trigger of the 09-13 config wipe, `9df8b08` (main `mergeStoredConfig.ts` header: "45s after 9df8b08 shipped"), IS on main, and `8fe3dc4` (the branch's patch-semantics fix, 09-03) is NOT its ancestor (O: `git merge-base --is-ancestor`). The fix for that wipe was written ten days earlier and sat parked on this branch. That is the same pattern as J12 (I).
2. **What the cap does with today's config.** In the owner's live row (updated 10-19), only `EDUCATION` and `PROF_EDUCATION` have `maxPerDay` = 2, and no category has `maxPerDayWeekend` (O, live read-only `SELECT`). `resolveCategoryDailyCap` falls back to the weekday value on weekends (branch `scheduling-defaults.ts` line 147). So after restore the builder still allows 2 coursework items a day, every day: the same number as main's constant `MAX_ASSIGNMENTS_PER_DAY`. "Weekend-aware" only takes effect once he sets a weekend value.
3. The recent-miss floor (`dce1fbb`) was "deploy HELD" by the owner (Inventory, O) and was **never live**. A surgical restore of J8 brings it in, enabled at `DEFAULT_RECENT_FLOOR_COUNT` (I did not read the constant's value). Ask before shipping it, or set the count to 0 (`resolveRecentCutoff` returns the plain window when `floorCount <= 0`, nexus.ts line 362, O).
4. `8fe3dc4` describes itself as unverified, and `assignment-cadence.ts` carries "STILL TO WIRE (Lane A)". This pass did not establish whether later branch commits verified that lane.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Builder caps coursework with a constant 2/day; the smart scheduler reads `maxPerDay` on its own; coursework sorted by priority; Settings saves merge into the stored config (#59) | One cap from config for all three placers, with an optional weekend value; deadline-band coursework order; missing due dates inferred from the weekly cadence; (held) recent misses always lead; saves can delete a key on purpose (`removeConfigKeys`) | Taking `schedulingService.ts` from the branch whole loses nothing functional (the branch has its own fail-closed patch save) but drops main's `mergeStoredConfig` import, which leaves `mergeStoredConfig.ts` unused; #61/#59/#31/#43/`get_task_topics` are lost as in J1/J5/J7 if those files are taken whole | 3-way merge; resolve the `schedulingService.ts` hunk to the branch side. Ship the recent-miss floor only with the owner's go (it was held). Treat `8fe3dc4`'s lanes as unverified: re-run `nexus.test.ts` and `assignment-cadence.test.ts` before deploy. |

**Live now (O):** builder v301, batch v491, smart v572, execute-tool v503, nightly-assignment-sync v246 — all from main (2026-10-19). `resolveCategoryDailyCap` is not live (Inventory: `maxPerDay` 0 hits in live builder). The client save path ships only through Lovable.

## J9 — The scheduler stops wiping task provenance

**Commits (O):** `2316dec` (2026-08-28): one new file, migration `20260828020000_preserve_task_provenance.sql` (107 lines). It creates `public.preserve_task_provenance()` and the `BEFORE UPDATE OF scheduling_context` trigger `preserve_task_provenance_trigger`, which carry the keys `source, origin, course_id, due_date_inferred, backfilled_from_meeting` across every `scheduling_context` rewrite (the writer's keys win).
**Files:** that migration only (branch-only; main has no file with "provenance" in `supabase/migrations`).
**What main changed in those files since the split (O):** nothing; it is a new file.
**Conflicts (O):** none.
**Live DB vs the file (O, read-only `SELECT` 2026-10-26):** the function exists and the trigger is on `tasks`. The live `prosrc` has the same statements as the file's body with the comments stripped (read both). It was applied as migration version **`20260828025806`**, not the file's `20260828020000`.
**Semantic note (I, medium confidence):** every branch migration's file timestamp differs from the version recorded in `supabase_migrations.schema_migrations` (O: e.g. dedup file `20260220000000` vs applied `20260820155525`; due-tomorrow `20260218000000` vs `20260818133453`). If these files land on main under their current names, a `supabase db push` / migration-diff would treat them as NOT applied and try to run them again. Most are `IF NOT EXISTS` / `CREATE OR REPLACE` and would re-run harmlessly. `preserve_task_provenance` does `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`, which is also safe to re-run, but it is a schema write. **Rename each file to the applied version when recording it on main**, so the repo matches the live migration history.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Already preserves provenance in production (the trigger is live), but the repo does not contain it, so a rebuild from main would lose it | Nothing new at runtime. The repo would describe the live schema again | nothing | Add the file to main renamed `20260828025806_preserve_task_provenance.sql`. Do not re-apply it. |

**Live now (O):** live in the DB (function + trigger). There is no edge-function part.

## J10 — Notification timing: user-timezone trigger times (no 4–5am pushes) + 9am local due-tomorrow reminder

**Commits (O):** `74ba671` (2026-08-18, `notification-scheduler/index.ts` +22/−14: compute `userNow` in the user's timezone; overdue reminders fire on the USER's 9am and are skipped in quiet hours), `a31db32` (migration `20260218000000_due_tomorrow_tz_aware.sql`: `schedule_task_reminders()` puts the due-tomorrow reminder at 9am local, + memory.md).
**Files:** `supabase/functions/notification-scheduler/index.ts`, the migration (branch-only).
**What main changed in those files since the split (O):** `notification-scheduler` — nothing (no main commit since `0459770`). Main's last change to it is `3de1b9b` (2026-09-13, "timezone-correct digest hour"), which reached main BEFORE the split, so the DIGEST hour is already timezone-correct on main through `_shared/timezone.ts` (`shouldSendDailyDigest(now, prefs.timezone)`, main line 171).
**Conflicts (O):** none. In the merged tree (`72d3cd8`), `notification-scheduler` holds main's timezone-aware digest check (merged line 178) AND the branch's `userNow` (153) and `generateOverdueReminders(..., now, userNow)` (173, 328, 345).

**What is still wrong on main today (O, read main's file):** the overdue reminder is not quiet-hours gated (main line 164: `if (prefs.overdue_reminders_enabled)`), and it fires on `now.getHours() === 9 && now.getMinutes() < 15` (main line 337). That is the server's 9am UTC, which is 5am in New York (4am after DST ends). This is the "4–5am push" J10 fixed. It is live (see below).
**Semantic note (O; consequence I):** the merged file would then hold two timezone methods: main's `_shared/timezone.ts` for digests and the branch's `toLocaleString(... timeZone)` for overdue reminders, with fallbacks `UTC` (branch, `prefs.timezone || 'UTC'`) vs the shared module's own default. Not wrong, but worth unifying onto `_shared/timezone.ts` in the same change (I). The branch's file also carries J13's alarm change (`250c3b1`, the task-backed calendar-alarm skip). See J13.
**DB part (O):** live `schedule_task_reminders()` is **byte-identical** (md5 `99e0890a…`, length 3463) to the function body in J15's migration `20261008150000_unscheduled_task_cancels_start_alarms.sql`. That body carries J10's 9am local due-tomorrow logic (file line 60: `(((NEW.due_date AT TIME ZONE user_tz)::date - 1) + TIME '09:00:00') AT TIME ZONE user_tz`). So J10's migration is superseded live by J15's. It was applied as `20260818133453`.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Digest at the user's local hour; due-tomorrow reminder at 9am local (DB, live); **overdue reminders at 09:00 UTC = 5am New York, even in quiet hours** | Overdue reminders at the user's 9am and never in quiet hours | nothing (main never changed `notification-scheduler` after the split) | Take the branch's `notification-scheduler/index.ts` (identical to a 3-way merge here), ideally switching `userNow` to `_shared/timezone.ts`. Record the migration on main renamed to `20260818133453`, but note that J15's migration redefines the same function later and is what is live. |

**Live now (O):** `notification-scheduler` v581 (2026-10-19) is **byte-identical to main** (0 diff lines; 0 hits for `userNow`). The 5am overdue push is live. The DB part is live, through J15's definition.

## J11 — Topic-index fragmentation fix

**Commits (O):** `1eda8f2` (2026-08-26), `classify-task-topic/index.ts` +90/−3. It sends the classifier only LIVE topics (`archived_at IS NULL AND merged_into IS NULL`), matches a reply exactly and then through `normalizeTopicName()` (filler words dropped, tokens sorted), revives an archived/merged topic instead of creating a duplicate, and tells the model a near-duplicate is a failure. Its commit body also records a one-off data cleanup (119 → 38 live topics; backup table `topic_cleanup_backup_20260825`).
**Files:** `supabase/functions/classify-task-topic/index.ts` only. The schema part (`archived_at`, `merged_into` columns) was applied live as migration `20260826022400_topic_index_dedup_and_lifecycle` (O, `schema_migrations`), but **there is no file for that migration on either main or the branch** (O: `git ls-tree` of both `supabase/migrations` finds no "topic" file).
**What main changed in those files since the split (O):** nothing. Main has no commit on `classify-task-topic` since `0459770`, so main-vs-branch is exactly J11's 93-line diff.
**Conflicts (O):** none.

**What main's own new work does with the same table (O, read main execute-tool):** main's `get_task_topics` (#42/#47/#52, Huddle's priorities widget) selects from `task_topic_index` with only `.eq('user_id', …)`. It does **not** filter `archived_at`/`merged_into`, so the widget receives archived and merged topics. Its own comment says "The owner has 169 topics" (10-15).
**Live data (O, read-only `SELECT` 2026-10-26):** the owner's index has **170** rows: **95** live, 75 archived, 3 merged. **55** of the 170 were created after the 08-26 fix, the newest on 2026-10-15, none since the 10-19 deploys. Since the cleanup, live topics have gone from 38 to 95 (the commit's own figure vs today's count). That is consistent with the fix no longer running (I).

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| The classifier sees every topic (archived ones included) and forks a new topic whenever the model's reply differs slightly from an existing name; `get_task_topics` returns archived/merged rows to the Huddle widget | The classifier reuses near-identical topics, revives dormant ones instead of duplicating them, and never offers archived topics | nothing | Take the branch's file (same as a 3-way merge). Add the missing migration file to main under the applied version `20260826022400` by reading the live columns (`archived_at`, `merged_into`) — do not re-apply. Separately, it is worth asking whether `get_task_topics` should hide archived/merged rows; that is a main-side question, not part of J11. |

**Live now (O):** `classify-task-topic` v306 (2026-10-19) is byte-identical to main (section 0.4). The columns are live. The fix is not running.

## J12 — Deploy guard, test/CI infra, drift check, shadow-run harness

**Commits (O):** deploy guard `93abcb6` (2026-09-08, "refuse a ref that does not contain origin/main") + `d131dca` (mutation-provable failure token) + `c2d9b4a` (fetch-depth fix); `3f2e786` (`check-edge-deploy-drift`: committed-but-not-deployed detector); `8fe3dc4` (`scripts/run-tests.mjs` test collector + `undef-check.mjs` symbols guard; `package.json`); `8fc7f73`/`4ed84fc` (guard fixes); `60e7565` (two unparseable workflows, `read-widget-debug-log.yml` and `test-priorities-widget-query.yml`, fixed); shadow-run harness `6024b0b`, `9e2c98a`, `05c2019`, `7b4fcaf`, `2bbf52b`.
**Files (O, `git diff --name-status origin/main <branch>`):** new on the branch: `.github/workflows/checks.yml`, `check-edge-deploy-drift.yml`, `scripts/run-tests.mjs`, `undef-check.mjs` (+ baseline, test), `check-edge-deploy-drift.mjs` (+ test), `assert-ref-contains-main.test.sh`, `scripts/shadow-run/*` (5 files), three `widget-*.py`. Modified: `deploy-supabase-functions.yml`, `read-widget-debug-log.yml`, `test-priorities-widget-query.yml`, `package.json`, `scripts/assert-ref-contains-main.sh` (mode only).

**What main changed in those files since the split (O):** `package.json` and `scripts/assert-ref-contains-main.sh` — `93aede9` (#55: same guard text, used only by `deploy-cloudflare.yml`; `test` also runs `cloudflare/src/*.test.ts`). `parse-edge-functions.yml` — `e919cb7` (main-only bundle-parse check on PRs; the branch does not have it, so a 3-way merge keeps it). `deploy-supabase-functions.yml`, both widget workflows — nothing.
**Conflicts (O):** `package.json`, 1 hunk: main `"test": "node --experimental-strip-types --test src/utils/*.test.ts supabase/functions/_shared/*.test.ts cloudflare/src/*.test.ts"` vs the branch `"test": "node scripts/run-tests.mjs"` + `check:symbols` + `check`. Take the branch side: `run-tests.mjs` already collects `cloudflare/src` (O: its `ROOTS` list, line 43, `min: 1`) and fails when a root matches zero files, which main's glob does not. `assert-ref-contains-main.sh` is add/add with identical text; keep mode 755.

**Semantic notes — this corrects an earlier claim (O; consequences I):**
1. **The guard would NOT have stopped the overwrite.** `assert-ref-contains-main.sh origin/main HEAD` fails only when the ref being deployed does not CONTAIN `origin/main` (its header and the `--is-ancestor BASE HEAD` order). A deploy FROM main always passes. The Inventory's line "its absence is how 10-19 overwrote J1–J11" is therefore wrong as worded. What the guard does is stop a BRANCH from deploying when it lacks main's fixes: the 09-03 incident in its own header. What would have prevented the loss is main containing the branch's work, which is what this restore does (I).
2. **The 10-19 "redeploy everything" is not explained by GitHub Actions.** On 2026-10-19 there was one `Deploy Supabase Functions` run, `39287074527` (push to main, `990b60d`, #60), and its log says `Changed functions: notification-delivery` and deploys only that function at 16:38:44 (O, job log). Yet ~70 functions carry the identical `updated_at` 2026-10-19 16:39:50.922 (O, `list_edge_functions`), including ones no recent PR touched (`ping`, `web-search`). No other workflow ran in that minute (O, runs list 16:00–17:30). So the identical stamp is a project-level event, not 70 deploys (I). Further (O, Actions API, every `deploy-supabase-functions.yml` run 2026-10-05..10-19): **no run on main since 10-08 executed the `Deploy all functions` step.** All 15 push runs on main ran `Deploy changed functions`. #59's push run (`c11b1a2`, 10-18 19:35) — which would have deployed everything, because it changed `_shared/` — **failed**. It was followed by two `workflow_dispatch` runs on main that ran `Deploy single function` (logs read: `smart-calendar-scheduler` and `nightly-schedule-builder`, both from main `c11b1a2`, 10-18 19:37). The last branch deploys were `workflow_dispatch` from nsishi on 10-05 and 10-08 (14:33/14:34, `8abea8b`). So the branch code was most likely replaced **function by function**, by main's ordinary per-PR deploys from 10-08 onward (I, medium). This pass did not establish when each function was replaced. The guard cannot catch any of those deploys, because each came from main.
3. **Main is red on every push today.** `read-widget-debug-log.yml` and `test-priorities-widget-query.yml` failed with zero duration on both 10-19 main pushes (`4fadd05`, `990b60d`; O, runs list). `60e7565` is the fix ("two unparseable workflows were failing EVERY push, on every branch"), and main has not changed those files since the split, so it applies cleanly.
4. The shadow-run tables are live (Inventory, O); the harness SQL is not on main.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Supabase deploys run from any ref with no ancestry check; `test` is a glob that passes on zero matches; two workflows fail on every push; bundle-parse check on PRs (`parse-edge-functions.yml`) | Supabase deploys refuse a ref missing main; one test collector + symbols guard + `checks.yml` CI; a committed-vs-deployed drift check; shadow-run harness; the two workflows parse | `parse-edge-functions.yml` (if the workflows folder is taken from the branch, it is deleted); main's `cloudflare/src` test entry (only if `package.json` is resolved to main) | Apply FIRST, before any feature, as its own PR: the guard, `checks.yml`, `run-tests.mjs`, `undef-check`, the drift check and `60e7565`. The drift check is what will show, after each later step, that what is committed matches what is deployed. Resolve `package.json` to the branch side. Keep `parse-edge-functions.yml`. |

**Live now (O):** CI only. No edge-function part. The guard is not in main's `deploy-supabase-functions.yml` (O: no `assert-ref` line).

## J13 — Phone alarm Done/Doing/Backlog/Park via a signed action token (+ alarms never batched, no task-less duplicate alarm)

**Commits (O, nsishi only):** `aecf460` (2026-10-05: `_shared/action-token.ts` 117 lines + test, new `alarm-action` fn 147 lines, `config.toml` `[functions.alarm-action] verify_jwt = false`, `send-push-notification` +15 mints the token, `manage-push-subscription` +11), `250c3b1` (alarms never batched + unique tag + deep link in `notification-delivery`; `notification-scheduler` skips the calendar alarm for an event that is just a task's mirror), `8abea8b` (2026-10-08: Backlog/Park from the alarm; delivery-side drop of start alarms for unscheduled tasks; J15's migration), `d1059fe` (header comment).
**Files:** `_shared/action-token.ts` + test, `alarm-action/index.ts`, `supabase/config.toml`, `send-push-notification/index.ts`, `manage-push-subscription/index.ts` (shared with J14), `notification-delivery/index.ts`, `notification-scheduler/index.ts` (shared with J10).

**What main changed in those files since the split (O):** `notification-delivery` — five commits (`275ecc4` #44, `ad1a751`, `b53fbca`, `93aede9` #55, `1d2dcf2`): the Oct 15 HTML briefing work. **#44 (`275ecc4`) also carried J13's own delivery hunks into main**: main already has `ALARM_TYPES`, `alarmDeepLink`, the per-alarm `_alarm_` batch key and `unscheduledStartNotifIds` (O, `git log -S` on main). `config.toml`, `action-token.ts`, `alarm-action`, `send-push-notification`, `manage-push-subscription`, `notification-scheduler` — nothing.
**Conflicts (O):** none in J13's hunks. `notification-delivery`'s 4 conflict hunks (merged tree lines 4–8, 15–21, 308–415, 449–456) are the September notify lane (section 0.1), not J13. Main-vs-nsishi for that file is `+4/−132` (O): **taking the branch's copy would delete 132 lines of main's Oct 15 briefing code**, and would gain nothing J13 needs, because main already has the alarm hunks.

**What is broken live today (O; consequence I):**
- Live `send-push-notification` v586 mints no token (Inventory, O), so alarm pushes carry no `actionToken`/`actionUrl`.
- Live `alarm-action` v36 (2026-10-08, `verify_jwt: false`) is still deployed. Its text matches `8abea8b`'s (O, read: header "only DOING/DONE, for 7 days", four statuses incl. BACKLOG/PARK).
- `activity_log` (O, read-only `SELECT`): 61 `android_alarm_action` rows from 2026-10-08 13:18 to **2026-10-14 22:15**, none since. Meanwhile `android_alarm_trace` rows continue to today (10,147 total, newest 2026-10-26 17:00). So the phone keeps alarming and tracing, but Done/Doing/Backlog/Park from the alarm stopped going through `alarm-action` after 10-14 (I, strong). Per the token module's own comment, the phone then falls back to its login path, which is the expired-JWT failure J13 fixed ("Done … closed the screen but never saved"). Expect tasks marked Done from the alarm to stay open and roll forward again.
- When each of these functions went back to main's code is not established from GitHub Actions: main has no commit on `send-push-notification` or `manage-push-subscription` since the split, and no main deploy ran "Deploy all functions" (J12 note 2).

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Alarms are never batched and carry a unique tag + deep link (on main via #44); unscheduled tasks' start alarms are dropped at delivery; **alarm buttons have no token, so Done/Doing only work while the phone holds a fresh login** | Every alarm push carries a 7-day signed single-task token; the alarm's Done/Doing/Backlog/Park work signed out or with the app killed; no task-less duplicate alarm for a task's own calendar event | 132 lines of main's briefing code in `notification-delivery` (if that file is taken from the branch) | Take the branch's copies of `action-token.ts` (+test), `alarm-action`, `send-push-notification`, `config.toml` (main never changed them). Take `notification-scheduler` as in J10. **Do not touch `notification-delivery`**: main already has J13's part. This is the highest-value, lowest-risk item: no conflicts, and the live breakage is measurable. |

**Live now (O):** `alarm-action` v36 deployed (orphan); `send-push-notification` v586, `notification-scheduler` v581, `manage-push-subscription` v586 equal main (no token, no skip). `notification-delivery` v591 equals main and already contains J13's delivery hunks.

## J14 — FCM hygiene: register the token on every app open; prune dead tokens; one device = one owner

**Commits (O):** `cc724d1` (2026-10-08, nsishi only: `src/App.tsx` +7/−2, new `src/utils/bridgeFcmRegistration.ts` 55 lines, `manage-push-subscription` +10/−1, `send-push-notification` +11), and its main twin `0459770` — the split point itself — whose message says "Same change as cc724d1 on the live functions line".
**Files:** `src/App.tsx`, `src/utils/bridgeFcmRegistration.ts`, `manage-push-subscription/index.ts`, `send-push-notification/index.ts`.
**What main changed in those files since the split (O):** nothing. **The client half is already on main**: `git diff origin/main <nsishi>` is empty for `App.tsx` and `bridgeFcmRegistration.ts` (O).
**Conflicts (O):** none. The remaining J14 diff vs main is the server side (O, read): `manage-push-subscription` accepts `source`, deletes other users' rows for the same `fcm_token` ("one device, one owner"), and logs `fcm_token_registered`; `send-push-notification` deletes a row FCM reports `UNREGISTERED` (404) and logs `fcm_token_pruned`.
**Live evidence (O, read-only `SELECT`):** 22 `fcm_token_registered` rows from 2026-10-08 13:43 to **2026-10-15 17:01**, none since. 2 `fcm_token_pruned` rows, both 2026-10-08 15:00. Today `push_subscriptions` holds 2 rows with an `fcm_token`. Since main's client registers on every app open, the stop in `fcm_token_registered` after 10-15 points to the server function no longer writing that log (it is main's code now), not to the phone no longer registering (I).
**Semantic note (I):** without the "one device, one owner" delete, if a second account (a UAT or test login) ever registers the owner's phone, both accounts' alarms arrive on it.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| The phone registers its FCM token on every app open (client, on main); dead tokens stay and keep failing; a token can belong to two accounts; registrations leave no trace | Dead (UNREGISTERED) tokens are deleted on first failure; one owner per device token; every registration is logged with its source | nothing | Take the branch's server files with J13 (same two functions). |

**Live now (O):** `manage-push-subscription` v586 and `send-push-notification` v586 equal main (section 0.4). Not running.

## J15 — DB maintenance cron + an unscheduled task cancels its start alarms

**Commits (O):** `ce80905` (2026-10-08, migration `20261008130000_db_maintenance_cron.sql`: four `pg_cron` jobs — `maint-http-response-vacuum` `*/15`, `maint-cron-history-prune` `17 4 * * *` (keep 7 days of `cron.job_run_details`), `maint-cron-history-vacuum` `27 4 * * *`, `maint-weekly-vacuum-full` `37 4 * * 0`; its header records `net._http_response` at 458 MB for 1,204 rows and `cron.job_run_details` at ~805K rows / 696 MB), and `8abea8b`'s migration `20261008150000_unscheduled_task_cancels_start_alarms.sql` (`schedule_task_reminders()`: when `start_time` is NULL, delete the task's undelivered START alarms).
**Files:** the two migrations (branch-only).
**What main changed in those files since the split (O):** nothing (new files). Main has ONE migration since the split that the branch lacks: `20261015180000_schedule_next_call_dedupe.sql` (O: `git diff --name-status` shows it as deleted relative to the branch).
**Conflicts (O):** none. **Naive hazard:** taking the branch's `supabase/migrations/` folder as a whole would delete main's `20261015180000_schedule_next_call_dedupe.sql` (the "one email instead of three" fix). A 3-way merge keeps it.

**Live state (O, read-only `SELECT` 2026-10-26):** all four `maint-*` jobs are active and every recorded run succeeded (0 non-success; last runs 2026-10-26 18:15, 04:17, 04:27 and 2026-10-25 04:37). Live `schedule_task_reminders()` is byte-identical to this migration's function body (md5 `99e0890a…`, 3463 chars; see J10). Applied versions: `20261008125356_db_maintenance_cron`, `20261008142455_unscheduled_task_cancels_start_alarms`.
**Semantic note (I):** this migration is the live definition of `schedule_task_reminders()`, and it ALSO carries J10's 9am local due-tomorrow rule. If someone rebuilt the DB from main's migrations alone, both behaviours would go back to main's older definition. Recording the file on main is the protection.

| Today (main) does | After surgical restore also does | Lost if done naively | Recommended handling |
|---|---|---|---|
| Already runs both live (cron jobs + trigger), but neither is in main's repo | Nothing new at runtime; the repo describes the live DB again | main's `20261015180000_schedule_next_call_dedupe.sql` (if the migrations folder is taken whole) | Add both files to main renamed to their applied versions (`20261008125356_…`, `20261008142455_…`). Do not re-apply. |

**Live now (O):** live in the DB; no edge-function part.

---

## Summary — what the Oct 15/18/19 main work would lose under each approach

**The two approaches, in one line each:**
- **NAIVE** = for each file a feature touches, take the branch's copy (`git checkout <branch> -- <file>`). Every main change in that file since `0459770` disappears.
- **SURGICAL** = a 3-way merge (or cherry-picks) of the branch's own edits onto main, with the September notify/Slack/briefing commits left out (section 0.1). Main's changes survive except where a conflict hunk is resolved the wrong way.

### Every main-side change at risk (O unless marked)

| # | file | what main's change does (date, sha) | J that touches the file | kept by 3-way merge? |
|---|---|---|---|---|
| 1 | `supabase/functions/smart-calendar-scheduler/index.ts` | stops writing a CATEGORY into `tasks.status` (10-08, `99289a4`, #31) | J1, J8 | **only if resolved by hand**: 1 conflict hunk; take the branch's trait block **minus** `suggestedStatus = …defaultStatus` |
| 2 | `src/components/TaskCreationModal.tsx` | new/imported tasks get `UP_NEXT`/`BACKLOG`, not a category (10-08, `fba5a34`, #28) | J7 | Y (auto) |
| 3 | `src/utils/assignmentFetching.ts` | three `status: 'PROF_EDUCATION'` → `'BACKLOG'` (10-08, `751904b`, #33) | J7 | Y (auto) |
| 4 | `.github/workflows/parse-edge-functions.yml` | bundle-parse check on every PR (10-08, `e919cb7`) | J12 (workflows) | Y — lost only if the workflows folder is taken whole |
| 5 | `supabase/functions/execute-tool/index.ts` | `get_task_topics` for Huddle's priorities widget (10-15, `4dec778`, #42/#47/#52); oldest default board in `createTask`/`parseAndCreateTasks` (10-15, `ec65855`, #43) | J1, J4, J6, J7, J8 | Y (auto; merged tree holds both sides) |
| 6 | `src/utils/assignmentSync.ts`, `supabase/functions/nightly-assignment-sync/index.ts` | oldest default board + `limit(1)`, ending the duplicate-board runaway (10-15, `ec65855`, #43) | J7, J8 | Y (auto) |
| 7 | `supabase/functions/notification-delivery/index.ts` | Oct 15 HTML briefing: meetings, rest-of-today + next 7 days, Iris window message (#44 `275ecc4`, #55 `93aede9` and others, 10-15); also already contains J13's alarm hunks | J13 | **Y only if the September notify lane is excluded**; otherwise 4 conflict hunks. Naive: −132 lines |
| 8 | `package.json` | `test` also runs `cloudflare/src/*.test.ts` (10-15, `93aede9`, #55) | J12 | conflict, 1 hunk; the branch side (`run-tests.mjs`) also covers `cloudflare/src`, so taking it loses nothing |
| 9 | `scripts/assert-ref-contains-main.sh` | same guard text, used by `deploy-cloudflare.yml` (10-15, `93aede9`) | J12 | add/add, identical text; keep mode 755 |
| 10 | `supabase/migrations/20261015180000_schedule_next_call_dedupe.sql` | one scheduled-call email instead of three (10-15, `275ecc4`, #44) | J15 (migrations folder) | Y — lost only if the migrations folder is taken whole |
| 11 | `supabase/functions/nightly-schedule-builder/index.ts` | a category goes only into its listed windows; a keyword window leads the category windows; `getPreferredWindows` moved to `_shared` (10-18, `c11b1a2`, #59) | J1, J2, J4, J5, J7, J8 | **only if resolved by hand**: 2 conflict hunks; keep main's `getPreferredWindows` import (the branch's code still calls it) and take the branch's `resolveWindowPlan` block |
| 12 | `supabase/functions/_shared/scheduling-defaults.ts` | shared `getPreferredWindows()` + `withKeywordWindow()` (10-18, `c11b1a2`) | J1, J2, J8 | Y (auto) |
| 13 | `src/services/schedulingService.ts` | a settings save MERGES into the stored config and refuses on a failed read (10-18, `c11b1a2`) | J8 | conflict, 1 hunk; **either side saves safely** (the branch carries its own patch save); never drop both |
| 14 | `src/config/schedulingRules.ts` | a removed keyword stays removed (10-19, `4fadd05`, #61) | J1, J5, J8 | Y (auto). Naive: the owner's removed keywords come back and are written back on the next Save |

**Not a file, but lost behaviour to watch (O from the live DB; consequence I):**
- `task_dedup_log` holds 4 not-yet-undone `skipped` rows whose saved `status` is a category ('VENTURES' ×2, 'LIFE' ×2). J6's `undo_dedup` would re-insert them as-is, re-creating #28/#31's bug on those rows. Patch `undoDedup` to re-derive `status`.
- The owner's `user_scheduling_prefs.config` has no `dedup` and no `scoringModel` key. After restore, J6's guard stays OFF and J5's scoring silently becomes **composite** (its default). Both should be stated to the owner.
- Branch migration file names do not match the versions applied live (J9). Rename each to its applied version when it lands on main, or a migration push will try to re-run them.

**Totals (O):** in a 3-way merge with the notify lane excluded, the main changes that need a human are rows 1, 11 and 13 (and the trivial rows 8/9). Every other main change survives automatically. Under the naive approach, rows 1–3, 5, 6, 11, 13 and 14 are lost outright, and 4/7/10 are lost if a whole folder or the notify file is copied.

### Recommended apply order

Each step is its own PR onto main. Each is checked before the next with J12's drift check and, for scheduler steps, J4's dryRun.

| step | what | why this position |
|---|---|---|
| 1 | **J12** — deploy guard in `deploy-supabase-functions.yml`, `checks.yml`, `run-tests.mjs`, `undef-check`, `check-edge-deploy-drift`, `60e7565` (the two always-red workflows). Resolve `package.json` to the branch side; keep `parse-edge-functions.yml` | Gives every later step a test gate and a committed-vs-deployed check. Note (J12): it does NOT stop a deploy from main; it stops a stale branch from deploying |
| 2 | **J9, J15, J11's schema, J2/J3/J6 table migrations** — add the files to main renamed to their applied versions; apply nothing | Zero runtime change; the repo describes the live DB again |
| 3 | **J13 + J14** — `action-token.ts`, `alarm-action`, `send-push-notification`, `manage-push-subscription`, `config.toml`; leave `notification-delivery` alone | Fixes measurable live breakage (alarm Done/Doing has not reached `alarm-action` since 10-14); no conflicts |
| 4 | **J10** (`notification-scheduler`, together with J13's calendar-alarm skip) | Stops today's 5am overdue push; no conflicts |
| 5 | **J11** (`classify-task-topic`) | Stops topic fragmentation (38 → 95 live topics since August); no conflicts |
| 6 | **J6** (dedup) with the `undoDedup` status fix; flag left OFF until the owner says | Execute-tool auto-merges; behaviour unchanged until enabled |
| 7 | **J7** (Nexus reads/writes); confirm `UAT_BYPASS_TOKEN` is set first | Large, client + server; must keep #28/#33/#43 (rows 2, 3, 6) |
| 8 | **J1 → J4 → J2/J3 → J5 → J8** (scheduler stack), resolving rows 1, 11 and 13 by hand, then a dryRun of the nightly build before deploy. Ask the owner about composite-by-default (J5), the held recent-miss floor (J8) and the 8am double message (J2 vs #57) | All six touch `nightly-schedule-builder`; this is where every hand-resolved conflict lives |
