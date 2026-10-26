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
