# INVENTORY — parked work across the owner's repos

WHAT: a list of all PARKED work — commits on feature branches that never reached the main branch — across the owner's repos, with what each piece does, whether the owner approved it, whether it was ever live, and how it now relates to main.
WHY: owner 2026-10-20: "i do want a list of the rest of all parked work". Trigger: journey-voice branch origin/claude/huddle-journey-integration-xokgv1 holds ~7.7k lines of owner-approved Aug–Sep work (Nexus assignment reader, weekend-aware cap, nudges, task-dedup, meeting confirmation, overflow queue, notification fixes, 9am tz-aware due-tomorrow migration) that never merged; main's later deploys likely overwrote what had been deployed from it (confirmed for nightly-assignment-sync: live v246 = main's version, no Nexus calls).
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: read-only research pass 2026-10-20 (git fetch of all refs + unshallow; GitHub PR search; Supabase live edge-function source).

## Method (how "parked" was decided)

Squash merges are the norm, so ancestry is not trusted. For every remote branch B (ignoring `eds-wip/*`, `uat-shots`):
1. `git rev-list --count main..B` = 0 → ancestor of main, not parked.
2. **Unlanded-line count** (scratch script): every non-trivial line (>3 chars) that B *adds* relative to `merge-base(main,B)` is looked up in main's current copy of the same file. A line absent from main is "unlanded". `.claude/` and `docs/` are counted separately (ledgers/evidence) from code.
3. Branches with 0 unlanded code lines are treated as **content in main** (squash-merged, or ledger-only). Branches with unlanded code were then read by hand, and their PRs looked up.

Caveat (INFERRED): a line counts as "unlanded" if main later *rewrote* it, so a branch whose work was merged and then refactored on main will show a residual count. Each row below was read by hand to separate that from genuinely parked work.

---

## 1. journey-voice (deventerprisesds/journey-voice) — main @ aeef3d3 (2026-10-19)

**Context that explains everything below (OBSERVED, branch's own memory.md, nsishi line ~1960):**
> "**Deploy line:** this repo's `main` is an 83-commit re-rooted line far behind what's live; the live functions come from `claude/huddle-journey-integration-xokgv1`."

PR #17 body (2026-10-08) says the same: *"the deployed functions come from that line, not from this repo's re-rooted `main`."*
Then **every edge function was redeployed on 2026-10-19 16:39 UTC** (list_edge_functions: execute-tool v503, nightly-schedule-builder v301, nightly-assignment-sync v246, notification-scheduler v581, send-push-notification v586, smart/batch schedulers, classify-task-topic, sync-*-sheets, send-chat-message, all stamped 2026-10-19T16:39).
- OBSERVED: live `nightly-schedule-builder` v301 is **byte-identical to main** (0 diff lines; 1091 diff lines vs the branch). Branch identifiers `dryRun` (71 hits on branch), `composite` (14), `nexus` (5), `maxPerDay` → **0 hits live**.
- OBSERVED: live `execute-tool` v503 and `_shared/tool-definitions.ts` are **byte-identical to main**; `undo_dedup` / task-dedup / Nexus reads → **0 hits live**. (A branch commit 8650dcd states deployed v418 on 2026-09-03 *did* contain `undo_dedup`.)
- OBSERVED: live `send-push-notification` v586 has **no** `actionToken` mint and **no** FCM UNREGISTERED prune.
- OBSERVED: the **DB-side** pieces survived, because migrations are not reverted by a function deploy: `list_migrations` shows `task_overflow_queue`, `external_event_attendance`, `due_tomorrow_tz_aware` (2026-08-18), `task_dedup_log`, `shadow_run_*` ×2, `topic_index_dedup_and_lifecycle`, `preserve_task_provenance`, `db_maintenance_cron`, `unscheduled_task_cancels_start_alarms` all applied. Live `public.schedule_task_reminders()` contains timezone handling and a 9am literal; `public.preserve_task_provenance()` exists. **None of those .sql files are on main** → the repo no longer describes the live schema.
- OBSERVED: orphan live functions not on main: `confirm-external-meeting` v125 (2026-08-29) and `alarm-action` v36 (2026-10-08). They still exist, but nothing in main's code calls/mints for them now (alarm buttons no longer receive a token from send-push-notification).

### 1a. `claude/huddle-journey-integration-xokgv1` — PR #26 OPEN ("feat(scheduling): dryRun harness…"), 204 commits ahead, last 2026-09-14
Unlanded: ~7,300 code lines (+11.9k ledger/docs) across ~70 files. Note: the **notify/Slack/Cloudflare Worker** part of this branch (Sep 8–14, `cloudflare/src/notify.ts` 356/358 lines present on main) **DID reach main** later via PRs #46–#57 ("bring main's worker in line with the live one") — it is NOT parked. Parked features, grouped:

| # | Feature (commits) | What it does (read from code/commit bodies) | Approval (quote, branch .claude ledgers) | Was live? | Main now |
|---|---|---|---|---|---|
| J1 | Scheduler Section A/B: de-fork + trait layer + weekend-evening protection + pinned appointments + capacity guard (Jul 24–31: 8231f14…32aaa71) | One shared window config for all three placers; LLM trait classification (venue-dependent/pinned/impact) with keyword table demoted to a LOUD fallback; protects weekend evenings; booked appointments immovable; `maxDailyHours` guard (made opt-in 07-31 after it thinned days) | memory.md: "Agreed direction (scoped: make the working 80% → 100%…)" (PR #17 body); memory: "SECTION B COMPLETE (B1–B6 all done, deployed, verified)" | yes (memory: "DONE + deployed") — **overwritten 10-19** (OBSERVED: live builder = main) | absent (main keeps its own `maxDailyHours`, 6 files) |
| J2 | Value-aware overflow queue + nudges delivery (6bdb2d8, 826d310) | Overflowed high-impact tasks go to `task_overflow_queue`; a single morning digest (default 8am local) of venue + overflow nudges via the existing `scheduled_chat` channel; fixed a message that claimed "scheduled after work" regardless | "describe the nudge widget for any final tweaks" → "**you can build nudge as provided**" | yes ("BUILT + DEPLOYED") — overwritten 10-19; table still live | absent (`nudges.ts` 0 hits on main) |
| J3 | External-meeting confirmation + slot release (28bc22b, 1719657) | Asks the user to confirm attendance for external meetings and frees the slot if declined; surfaced in Daily Review | memory: "B6 External-meeting confirmation + slot release DONE, deployed, LIVE-verified end-to-end" | yes — `confirm-external-meeting` v125 **still deployed (orphan)**; its surfacing in the builder overwritten | absent |
| J4 | dryRun harness + conflict-aware "Add a task for today" (Aug 11–12) | Zero-write dry run of the nightly builder and of `parse_and_create_tasks`; conflict-aware apply was **reverted on the branch itself** (a0dc8ec/f42043e) | actions.md 2026-08-11 Request: "recently-added due-today items must bubble into today's schedule…" | dryRun deployed per ledger; overwritten | absent |
| J5 | Composite scoring model (switchable, then default) + category maxPerDay + overdue escalation (925d9df, c5de8f4, 5445bc2, 055e8ca, bf347d4 priorityBoost) | Per-user `scoringModel` (composite vs priority-rank) with Settings toggle; enforces e.g. PROF_ED ≤2/day; recent-overdue escalation | "build those two pieces (UI toggle + builder config-read) so the switch is genuinely self-serve" | yes ("deployed; verified live ≤2 PROF_ED/day") — overwritten | absent (`scoringModel` 0 hits on main) |
| J6 | Task dedup guard + `undo_dedup` (22f145b, 0800e59) | Creation-time normalized+semantic duplicate detection in `create_task`/`parse_and_create_tasks`; notifies via Iris chat; undo tool | "are we missing a fuzzy dedup? **build one** — normalized + semantic … notify me on every dedup so I can review/undo." | yes ("BUILT + DEPLOYED + VERIFIED LIVE + ENABLED"; in deployed v418) — overwritten | absent; `task_dedup_log` table still live |
| J7 | Assignments from **Nexus on Azure** everywhere (e45d30a, 225a3a7, 0969b9d, 06b0eba) | `nightly-assignment-sync`, `list_pending_assignments`, the web Assignments page and Task modal read the live MIT course from Nexus (Azure) instead of the frozen Supabase `public.assignments` snapshot (newest row 2026-04-06); sheet syncs write to Nexus | "**yes** (approved plan)" after "we will only focus on the ai MIT course"; then "do both... nexus live no mirror needed" | yes ("BUILT + DEPLOYED + VERIFIED LIVE") — overwritten (caller-confirmed: live v246 = main) | absent (`_shared/nexus.ts` not on main) |
| J8 | Weekend-aware, config-driven per-day assignment cap + deadline-triage / recent-miss ordering (dce9f92, 2a1883f, dce1fbb, assignment-cadence.ts) | Replaces the hard-coded `MAX_ASSIGNMENTS_PER_DAY=2` (builder) and two independent `maxPerDay` reads with one `resolveCategoryDailyCap()`; weekend-aware; coursework order by deadline bands; "N most recent misses always lead" | "1 make the cap configurable and weekend-aware, 2 reconcile the two caps into one, 3 apply the confirmed order" → "**the plan looks good. go until deployed**"; recent-miss floor = "owner-proposed … deploy HELD" | cap: yes (deployed 08-29) — overwritten; recent-miss floor: **never deployed** ("deploy HELD") | absent |
| J9 | Scheduler stops wiping task provenance (2316dec) | `preserve_task_provenance` trigger merges `scheduling_context` instead of replacing it | "you broke something correct? don't you have to fix it?" (owner challenge → fix) | yes — **still live in DB** (OBSERVED: function exists) | SQL file absent from main (schema drift) |
| J10 | Notification timing: TZ-aware triggers / no 4–5am pushes; 9am TZ-aware due-tomorrow (74ba671, a31db32) | `notification-scheduler` computes trigger times in the user's timezone; `schedule_task_reminders()` places due-tomorrow reminders at 9am local | memory "5am-notification fixes" (no verbatim approval line found; bug-fix of an owner-reported 4–5am push) | DB part: **still live** (OBSERVED: live fn tz-aware, 9am). Edge-fn part: PR #17 says shipped 10-05; INFERRED overwritten 10-19 (notification-scheduler redeployed from main; branch's 12 lines absent from main) | DB sql absent from main; fn part absent |
| J11 | Topic-index fragmentation fix (1eda8f2) | `classify-task-topic` stops creating near-duplicate topics; lifecycle columns | not found as a quote (INFERRED part of Aug-26 work) | migration live; fn INFERRED overwritten 10-19 | fn change absent |
| J12 | Test/guard infra: `scripts/undef-check.mjs`, `run-tests.mjs`, `checks.yml`, `check-edge-deploy-drift`, `assert-ref-contains-main` deploy guard, shadow-run harness (Aug 20 – Sep 13) | Symbols guard, test collector, CI, a check that "committed ≠ deployed", deploy workflow refusing a ref that does not contain origin/main, cloned-user shadow runs | "deploy workflow now REFUSES a stale ref (**owner request**, 2026-09-08)" | CI only; shadow tables live | absent — **note the deploy guard (93abcb6) that would have refused a stale ref is itself parked**, which is why main's 10-19 deploy could overwrite |

Relation to main / conflicts (OBSERVED by file): main since re-rooting changed the same files — PRs #28–#33 (status-not-category, edits `nightly-schedule-builder`, `ai-task-parser`, voice path), #59 (scheduling saves merge; categories in their windows; keyword windows relax → `SchedulingSettings.tsx`, `schedulingRules.ts`), #61 (removed keyword stays removed), #42/#47/#52 (`get_task_topics` in execute-tool), #44–#57 (notification-delivery, Worker). `git merge-tree` of the branch onto main = **CONFLICT**.
**Bring-back risk: HIGH** — not mergeable as a branch; must be re-applied feature by feature onto main's builder/execute-tool (which diverged), each re-verified. DB objects already exist, so re-applying code is mostly code-only.

### 1b. `claude/mobile-widget-web-bridge-debug-nsishi` — PR #17 OPEN, = xokgv1 + 11 commits, last 2026-10-08
Contains all of 1a plus:

| # | Feature | What it does | Approval | Was live? | Main now |
|---|---|---|---|---|---|
| J13 | Phone alarm Done/Doing/Backlog/Park via signed action token (aecf460, 250c3b1, 8abea8b) | `_shared/action-token.ts` (HMAC of service-role key, 7-day, no new secret); new `alarm-action` fn; `send-push-notification` mints token into FCM data; alarms never batched; task-less duplicate calendar alarm dropped; Backlog/Park from the alarm | Bug-fix of observed failure ("Done … closed the screen but never saved … `pushed_count` 44 on 'Go to church'"); PR #17: "**code, already deployed**". No verbatim owner "go" found | yes (10-05/10-08). **Now broken-by-overwrite**: OBSERVED live send-push-notification v586 mints no token, so the still-deployed `alarm-action` v36 never receives one | absent |
| J14 | FCM hygiene (cc724d1, 0459770) | Register phone FCM token on every app open; prune UNREGISTERED tokens ("6 dead tokens, ~60 failures/day") | not quoted | registration: merged from main (3f07dcb "web FCM registration fix" came FROM main); prune: OBSERVED absent live | prune absent |
| J15 | DB maintenance cron + unscheduled-task alarm cancel (ce80905, 8abea8b migration) | `maint-*` pg_cron vacuum of `net._http_response`; clearing `start_time` deletes queued start alarms | — | **live in DB** (migrations applied) | SQL absent from main |
| J16 | `verify-live-web.yml` | Headless check of what the Lovable web app serves | — | CI only | absent |

**Bring-back risk: HIGH** (same reasons) — but J13/J14 are small and self-contained (~730 lines) and could be re-applied alone at MEDIUM risk.

### 1c. Smaller journey-voice parked branches

| Branch (PR) | Last | What it does | Approved? | Live? | Main now | Risk |
|---|---|---|---|---|---|---|
| `claude/friendly-turing-mlr1bf` commit 9638f09 (no PR; pushed after #44/#45 merged) | 10-15 | `execute-tool` `get_calendar_events`: exposes journey's synced external calendar so Huddle's 8am/8pm brief can list meetings (Huddle's app-only Graph read 403s) | none found | OBSERVED not in live v503 | absent | low (59 lines, one tool) |
| `claude/env-setup-agent-scenarios-0jmtoy` 8650dcd (no PR) | 09-03 | Machine-readable tool classification (`INTERNAL_TOOL_NAMES`, `TOOL_ALIASES`, `CLIENT_LOCAL_TOOL_NAMES`); no advertised-tool change | none; commit says "NOT DEPLOYED" | no | absent | low |
| `claude/app-load-caching-ieosfy` (PR #13 OPEN) | 06-30 | Persist React Query cache to localStorage; stop reloads on background/foreground | none found | no (web client deploys via Lovable) | absent (`persistQueryClient` 0 hits) | med (touches App.tsx/contexts that Lovable has since rewritten) |
| `claude/priority-widget-nesting-1jtwa9` (PR #12 **merged** 06-29) | 06-29 | category > group > sub-group tree in Priorities | merged | was | `CategoryTreeSection` 0 hits on main → **removed/rewritten later on main**, not parked | n/a |
| `claude/deploy-fcm-supabase-prod-6jpp3q` (no PR) | 06-23 | Local datetime + explicit tz to Outlook/Google event creation; `dueDate` fallback for start; activity_log traces | none | unknown | main has extensive tz handling (51 files) — INFERRED superseded | low value |
| `claude/supabase-nextjs-setup-12xqqk` (no PR) | 06-27 | Next.js `@supabase/ssr` helpers + committed `.env.local` | none | no | absent; not applicable (app is Vite) | discard |
| `claude/chat-notification-routing-a9vi93` (no PR) | 06-26 | `/chat` route + push deep-link routing | none | unknown | `/chat` route absent | low |
| `claude/journey-widgets-in-chat` ec508a5 (no PR) | 09-12 | read-only `get_task_topics` | — | — | **superseded** by main PR #42/#47/#52 | discard |
| `claude/new-session-eonf2r` (PR #21 closed unmerged 09-21) | 07-31 | definition_of_done + cleanup-board skill | — | — | ledger 09-21: "#21 closed-superseded"; `definition_of_done` persisted via #24 | discard |
| `claude/setup-stop-hooks-skills-0h569y` (PR #22 merged) | 08-03 | title→id fuzzy resolver; tokenizes on non-alnum | merged | — | main has a tokenizing resolver (execute-tool:580) — residual lines are later rewrites | n/a |

Not parked (0 unlanded code lines; squash-merged or ledger-only): `claude_schedule-sanity-timing` (PR #62 open, ledger only — this session), `claude_scheduling-config-merge-save`, `claude_restore-scheduling-keywords`, `claude_restore-notify-auth`, `claude_ledger-*`, `claude_iris-window-trigger`, `claude_board-*`, `claude_email-*` (merged #49–#55; small residuals are later rewrites), `update-claude-md-docs-da8gc4`, `setup-skill-config-iat9za`, `commsconsole-route`, `funny-faraday`, `eds-skills-chat-widget`, `cleanup-workflow-only`/`remove-cleanup-workflow` (one-shot, intentionally removed), June FCM/outlook branches (PRs merged; ≤24 residual lines).

---

## 2. huddle-extension-app (deventerpriseds-org) — main @ 1ddb3e4 (2026-10-20)

114 remote branches (excl. eds-wip/uat-shots); 64 are plain ancestors of main; of the 50 ahead, 31 add 0 unlanded code lines (squash-merged or ledger-only). Only **one open PR** in the repo (#14). Huddle deploys automatically from `main` (`deploy-swa.yml` on push), and its PR discipline has held — **very little is parked here.**

| # | Branch (PR) | Last | What it does | Approval | Live? | Main now | Risk |
|---|---|---|---|---|---|---|---|
| H1 | `claude/huddle-ai-knowledge-library-lxia7z` (**PR #14 OPEN**) | 07-27 | 984 lines: a per-agent "knowledge pack" (frameworks, vocabulary, benchmarks, playbooks, anti-patterns) for all 15 agents, injected into BOTH instruction branches; additive, routing unchanged; 61 tests | **Not approved.** PR body: live test "pending the go-ahead to dispatch `deploy-swa.yml`". main memory.md (09-21 PR triage): "Left #14 (agent knowledge library) OPEN — … a distinct capability from ACT-61's memory-intake system, not for merging as-is nor closing; **still needs the user's call**." | no | absent (`data/knowledge/` not on main) | med — `huddle.functions.ts` has moved ~3 months; injection points must be re-placed |
| H2 | `claude/web-search-azure-function-t4uum6` (no PR) | 07-09 | Azure Function port of a Tavily web-search proxy + deploy workflow | none found | INFERRED no | **superseded**: main has an in-process `TAVILY_WEB_SEARCH_TOOL` (huddle.functions.ts:70) + per-agent toggle | discard |
| H3 | `verify/forcers-ceremony-check` (no PR) | 08-01 | One-off verifier harness (`e2e/verify-forcers.e2e.mjs`) | n/a (verifier artifact) | n/a | absent | discard (evidence only) |
| H4 | `prevent-task-dupes` | 07-24 | cross-turn dedup in `create_huddle_task` | — | — | **on main** (`loadExistingOpenTitles`, huddle.functions.ts:1874); 9 residual lines are later rewrites | n/a |

Merged, residual lines are later edits on main (OBSERVED: feature present on main, PRs merged): `claude_verify-inbound-email-watch` (PRs #82/#85/#87/#90/#93 merged), `claude_schedule-alerts` / `claude_schedule-brief-fix` / `claude_iris-brief-*` (`schedule-brief.server.ts` on main), `claude_priority-*`, `claude/nexus-*-tools` (56/563 and 5/633 residual), `claude_scheduler-one-user`. Companion change from journey PR #17 (`schedule_reminder` optional `task_id`) **is on main** (reminders.ts:35,129). Ledger/UAT-only branches (`verify/*`, `qa-progress`, `claude_ledger-*`, `claude_focus-uat`, `board-status-dropdown`, `tmp-appid`) carry no product code.

**huddle-extension-app verdict (OBSERVED, re-fetched 2026-10-20, main @ 1ddb3e4):** one genuinely parked feature (H1, the agent knowledge library, PR #14, waiting on the owner's call). Everything else is either already on main, superseded, or one-off verifier/ledger material. **Bring-back risk for the repo as a whole: LOW** — no owner-approved feature is stranded here.

---

## 3. nexus-hub (deventerpriseds-org) — main @ e277f942 (2026-10-20)

Re-fetched 2026-10-20. 45 branches ahead of main; most have 0 unlanded code lines (ledger/AC/verify-only, or squash-merged via PRs #53–#148). Six PRs are open: #150 (today, in flight — **not parked**, it is live work: the module-save outage fix), #149 and #136 (research docs only), and the three below that hold code.

| # | Branch (PR) | Last | What it does (read from code + commit bodies) | Approval (quote) | Live? | Main now | Risk |
|---|---|---|---|---|---|---|---|
| N1 | `claude/nexus-course-backup-rag-kj5azd` **PR #127 OPEN**, commits after #125 merged (09-11 → 09-14), ~930 unlanded code lines, 16 files | 09-14 | **(a) Page-body capture gate:** the extension judged saved page BODIES by the page INDEX's coverage, threw away a partly-successful capture, and wrote a receipt counting pages *tried*, not *saved*. Adds a `partial` state (bank what arrived, `record_count` NULL). **(b) Page identity as an equivalence class:** one real page stored under a page id and a url is counted once (`pageVideos.ts` union-find). **(c) Import "Get transcript" uses the shared predicate** (stops a dead button on Kaltura/Zoom videos). **(d) Outline draft gate scope** (`outlineMapping.ts` `UNANSWERABLE_BY_ANY_SECTION` + option sets): stops refusing a draft over submission/course requirements and untaken "Option 1/2/3" alternatives | (a–c) branch actions.md: *"why are so many pages not saved?"* and *"fix everything you've pointed it and stop just saying you will"*. (d): *"this panel is architected, modeled and tested horribly. It is saying it cant create a draft for the silliest reasons … **fix immediately as it is blocking me.**"* | **No.** Ledger (d): "**Done, pushed, NOT deployed.**" PR body: "None of this has been seen in the owner's browser". SWA deploys from main (OBSERVED: main ledger line 825 "NOT LIVE: on `…kj5azd`; the SWA deploys from `main`") | **Partly redone for (a) only:** main's dfc492cc (10-15, PR #143) added a `coverageFor()` slug-bodies fallback, written from the owner's 09-21 MGT-701 capture (29 pages fetched, none banked). OBSERVED absent on main: the `partial` state, the receipt-count fix, the equivalence class (`pageIdentity` still single-key), `UNANSWERABLE_BY_ANY_SECTION`. `git merge-tree` = CONFLICT in `extension/orchestrator.js`, `one-scrape.test.mjs`, `manifest.json` (plus ledgers) | **MED.** (d) is self-contained in `outlineMapping.ts` with no conflicts and the owner called it blocking, so it's low on its own. (a) must be reconciled by hand with main's different fix of the same defect |
| N2 | `claude/env-setup-agent-scenarios-0jmtoy` **PR #96 OPEN** (titled "Accuracy log…", body says "Net diff: one file, +10 lines") — but commits **9428ef9f + cfb663b6 were pushed onto it afterwards** | 09-08 | **A live retrieval bug fix hidden behind a docs PR.** The EMBA assistant chat scopes its pgvector search with `metadataFilter: {course_id}`. Commit body: measured over all 868 chunks, `topic_id` is on 868 and `course_id` on **0**, so "whenever the caller told the assistant which course the student meant, retrieval returned ZERO of that student's material, silently." Adds `courseMetadataFilter()` as the one home for the key, plus an 8-check guard test | **None found** (agent-found defect; no owner quote on the branch; main's actions.md and memory.md have **no mention** of it, OBSERVED by grep) | **No** | **Absent, and the bug is still live on main** (OBSERVED: `origin/main:api/src/functions/embaAssistantChat.ts:470` still `{ course_id: context.courseId }`; `knowledgeSearch.ts:139` uses the correct `topic_id`) | **LOW** — 174 lines, 5 files, API only. INFERRED the highest value-per-line item in this repo |
| N3 | `claude/outline-attempts-override` **PR #82 OPEN** | 09-08 | Makes the outline retry ceiling (hard-coded 5) settable through an Azure app setting `MAX_OUTLINE_ATTEMPTS`, clamped to 1–10, so a UAT run can force the never-executed "repair / keep_all" discussion-gate branch. Includes a `verify-uat.yml` set/restore step | No owner quote. PR body: deploying it "puts unmerged code on the live API — an outward-facing action… **Raising it rather than taking it.**" | **No** (PR body: deployed SHA `3b86a2b` has `const MAX_OUTLINE_ATTEMPTS = 5`) | absent | **LOW–MED.** It's a test hook on a production path; `generateOutline.ts` has moved since 09-08 |
| N4 | `claude/fix-turn-is-real` (no PR) | 09-08 | Bridge-probe workflow steps Q7.1–Q7.4, which assert a forwarded cross-app turn left real rows (pending_turns, rag_chunks) | n/a (probe) | CI only | absent; the sibling Q6 telemetry probe merged (#68/#69) | low, test-only |
| N5 | `verify/assistant-batch-uat` (no PR) | 08-25 | Playwright checks for the assistant batch; commit title says "(not for merge)" | n/a | n/a | absent | discard (verifier artifact) |
| N6 | `video-proof` (orphan, no common history) | 09-04 | Screenshots, an .srt and compare.json from one video-proof run | n/a | n/a | n/a | discard (evidence only) |

Not parked (0 unlanded code lines, or ≤4 residual lines that are later rewrites of merged PRs): `claude/assignment-recapture-update` (#131 merged), `claude/d1-unknown-column-400` (#92), `claude/nexus-vector-search-route` (#95), `claude/nexus-write-preimage-log` (#94), `claude/optionb-merged*` (#111), `claude/uat-discussion-workflow` (#77), `claude/uat-token-owner-fence` (#93), `claude_schedule-program-id*` (#132/#133), `claude_parallel-test-runner` (#137), every `claude/ac-*`, `verifier/*` and `*-ledger` branch, `claude_canvas-scheduling-research` (#149, docs), `claude_sustained-extraction-research` (#136, docs).

**nexus-hub verdict:** two owner-requested fixes are stranded in PR #127 (one of them, the draft gate, called "blocking" by the owner). One live bug fix (N2) is hidden behind a PR whose title and body describe something else.

---

## 4. android-bridge-template (deventerprisesds) — main @ f41e814 (2026-10-19)

No open PRs. 14 branches ahead of main. **Nothing meaningful is parked.**

| Branch (PR) | Last | What it is | Main now | Verdict |
|---|---|---|---|---|
| `claude_mut-volume-keys`, `claude_mut-silence-key`, `claude_mut-unlock-grace`, `claude_mut-echo-window`, `claude_mut-alarm-sound-order`, `claude_mut-gate-silent` | 10-15 → 10-19 | Each is a feature commit plus a top commit titled **"MUTATION (do not merge/throwaway)"**: a deliberately broken copy pushed so CI proves the alarm tests catch it | OBSERVED: the features underneath all merged via PRs #4–#9 (`claude/funny-faraday-k7z1an`, 10-15 → 10-19). With the mutation commit excluded, residual lines (8–22) are earlier drafts that #8/#9 later rewrote | **intentionally unmerged; safe to delete** |
| `claude/alarm-sounds-source-ptnn0g` (PR #2 closed unmerged) | 07-26 | Huddle app config under id `cc6dd330…` | **superseded**: main carries a Huddle config under `8596e6c2…` | discard |
| `claude/update-claude-md-docs-da8gc4` (PR #1 closed unmerged) | 07-21 | Premature alarm sound / double-dismiss / custom-sound fallback fixes | INFERRED superseded: the Oct alarm rewrite on main has an `autoStop`, a gate path and the sound fallback chain (`AlarmSoundService.kt`); 8 residual lines | discard |
| `claude/deploy-fcm-supabase-prod-6jpp3q`, `claude/chat-notification-routing-a9vi93`, `claude/fcm-supabase-payload-mapping-fjecdx` (no PR) | 06-22 → 06-26 | June FCM/alarm fixes; deep-link routing | INFERRED superseded: main has `deepLink` intent routing (`MainActivity.kt:147`), a 60s tone cap (`GATE_TONE_MAX_MS`), the `task-reminders` channel | discard |

**Bring-back risk: n/a.**

---

## 5. bridge-builder (deventerprisesds) — main @ 222ba67 (2026-06-27)

The repo has been dormant since June. One PR ever (#1, merged).

| Branch (PR) | Last | What it does | Approved? | Live? | Main now | Risk |
|---|---|---|---|---|---|---|
| `claude/app-load-caching-ieosfy` (no PR) | 06-29 | `web/src/main.tsx`: React Query `staleTime` 30s → 5 min, plus a `gcTime` (commit: "Matches the caching strategy set in journey-voice") | none found | no | absent (OBSERVED: main `staleTime: 30_000`) | low (6 lines) |
| `claude/supabase-client-install-gouei1` (no PR) | 06-27 | Installs `@supabase/supabase-js` with empty client stubs in web + api | none found | no | absent | discard (scaffold; nothing uses it) |
| `claude/new-session-mt737l` | 06-26 | — | — | — | PR #1 merged; 0 unlanded | n/a |

---

## 6. eds-claude-skills (deventerpriseds-org) — main @ 1a86d3e (2026-10-15)

54 branches ahead of main; nearly all have 0 unlanded code lines, or small residuals from setup.sh rewrites (`claude_hdrslug-probe-*`, `claude_ledger-*`, `claude_verify-*`, `claude_gate-*` all merged via PRs #90–#119). **One PR is open (#23).** A 10-02 triage (main actions.md `ACT:open-pr-backlog-triage`) measured the rest by **"files main lacks"**, which misses changed CONTENT in files main already has, so the three below were re-checked by content.

| # | Branch (PR) | Last | What it does | Approval | Live? | Main now | Risk |
|---|---|---|---|---|---|---|---|
| E1 | `claude/setup-registration-summary-1an4v1` **PR #23 OPEN** | 08-28 | ACT-12: `eds-perms-apply.py`, a single writer that re-applies `permissions.allow` / `autoMode.allow` to `launcher-settings.json` on every prompt (the launcher regenerates that file on each restart). Also fixes a defect where an unreadable settings file was overwritten with `{}`, destroying `permissions.hard_deny`. 58 checks, 26 mutations | none quoted. Main ledger 09-21: "Left **#23** (mid-session permission-repair gap, **still real**, but its `setup.sh` diff is ~39 versions stale) … OPEN for the owner's call" | no (PR: "NOT yet confirmed across a real container restart") | absent (OBSERVED: `eds-perms-apply` appears on main only in a triage note; setup.sh still merges the lists once, at build) | **HIGH** as a merge (setup.sh moved v19 → v68+); the idea must be re-derived against current setup.sh |
| E2 | `claude_gate-marker-termination` (PR #92 **closed unmerged 10-02**) | 09-26 | Push gate: if the GLOBAL-RULES block in the rules file has no END marker (a truncated write), `sed` prints to end of file, so a stray `claude_` anywhere turns the branch rule on. The fix requires END to appear in the slice; adds 4 tests (T1–T4) | none (found by an independent verifier on PR #91) | no | **absent** (OBSERVED: `origin/main:scripts/eds-push-gate.sh:596` still pipes the open range straight into `grep -q 'claude_'`) | **LOW** (~20 lines in one function, plus tests) |
| E3 | `claude_fanout-partition` (PR #93 **closed unmerged 10-02**) | 09-27 | Three things: (a) multi-agent-patterns: partition a fan-out by shared build output, not only by files owned; (b) **owner rule: "Always Provide screenshots for feasibility"** added to `verify-work.md`/`brief-checklist.md`; (c) wires `check-accuracy-themes.sh` as a preflight hook in setup.sh | (b) owner, 09-27: *"How can you possibly have access to hbr and or Kindle for testing? **Always Provide screenshots for feasibility.**"* | no | (a) and (b) **absent** (OBSERVED: no "build output" in multi-agent-patterns.md, no feasibility-screenshot rule in skills). (c) INFERRED superseded by #111/#112 (session-start theme surfacing) | (a)(b) **LOW** (prose in skills); (c) discard |
| E4 | `claude/boost-app-setup-approach-4uruha` (PR #38 closed 10-02) | 09-03 | Two-layer setup: the build-time clone has no credential, so install at session start | owner's open decision per main tracker | — | **superseded** by #116 "Self-healing bootstrap…" (merged 10-08) | discard |
| E5 | `claude/repo-access-check-corxal` (#14), `claude/update-claude-md-docs-da8gc4` (#2), `claude/new-session-eonf2r` (#1), `claude/deploy-wait-preference` (#5), `claude/eds-setup-postgres-connectors-nqujcn` (#37) | 07–09 | ac-writer agent; skills docs; wait-for-deploys skill; evidence | — | — | main ledger 09-21: "Closed #1, #2, #5, #14 as superseded … Closed #37 (main independently reached a *more* resolved version)" | discard |
| E6 | `enforce-mandatory-skills`, `skills-merge-uat-into-verify`, `gate-require-memory`, `claude/eds-skills-setup-j8gy0e` (no PR) | 07-23/24 | July setup.sh edits | — | — | INFERRED superseded: `uat` is merged into `verify-work` on main; mandatory-skill enforcement lives in the Stop gate; setup.sh has been rewritten since | discard |

---

## SUMMARY — every parked feature, sorted by repo

Labels: **O** = OBSERVED (read from git, the GitHub API or the live Supabase function source this pass); **I** = INFERRED.

| Feature | Repo / branch | What it does | Approved? (quote) | Was live? | On main now? | Bring-back risk |
|---|---|---|---|---|---|---|
| J1 Scheduler de-fork, traits, weekend-evening protection, pinned appts, capacity guard | journey-voice / xokgv1 (PR #26 open; also in #17) | One shared window config; LLM trait classification; immovable appointments | "Agreed direction… make the working 80% → 100%" (O) | yes, overwritten 10-19 (O) | no (O) | HIGH |
| J2 Overflow queue + morning nudge digest | journey-voice / xokgv1 | Overflowed high-impact tasks queued; one 8am digest | "you can build nudge as provided" (O) | yes, overwritten; table live (O) | no (O) | HIGH |
| J3 External-meeting confirmation + slot release | journey-voice / xokgv1 | Confirm attendance, free slot if declined | memory "DONE, deployed, LIVE-verified" (O) | yes; `confirm-external-meeting` v125 orphaned (O) | no (O) | HIGH |
| J4 dryRun harness | journey-voice / xokgv1 | Zero-write dry run of builder/parser | actions.md 08-11 request (O) | yes, overwritten (I) | no (O) | HIGH |
| J5 Composite scoring + category maxPerDay + overdue escalation | journey-voice / xokgv1 | Switchable scoring model; PROF_ED ≤2/day | "build those two pieces… genuinely self-serve" (O) | yes, overwritten (O) | no (O) | HIGH |
| J6 Task dedup + undo_dedup | journey-voice / xokgv1 | Normalized + semantic duplicate guard, Iris notice, undo | "are we missing a fuzzy dedup? **build one**" (O) | yes (v418), overwritten (O) | no; `task_dedup_log` live (O) | HIGH |
| J7 Assignments read from Nexus (Azure) | journey-voice / xokgv1 | Nightly sync, list tool, Assignments page read live MIT course | "**yes** (approved plan)" / "nexus live no mirror needed" (O) | yes, overwritten (O, live v246 = main) | no (O) | HIGH |
| J8 Weekend-aware per-day assignment cap + deadline-triage order | journey-voice / xokgv1 | One config-driven cap; deadline bands; recent-miss floor | "the plan looks good. go until deployed" (O) | cap yes, overwritten; miss-floor never (O) | no (O) | HIGH |
| J9 Preserve task provenance | journey-voice / xokgv1 | Trigger merges `scheduling_context` | owner challenge → fix (O) | **still live in DB** (O) | SQL not on main (O) | LOW (record the migration) |
| J10 TZ-aware notifications; 9am due-tomorrow | journey-voice / xokgv1 | No 4–5am pushes | bug-fix of owner report (I) | DB part still live (O); fn part overwritten (I) | no (O) | MED |
| J11 Topic-index dedup | journey-voice / xokgv1 | classify-task-topic stops near-duplicates | none found | migration live (O); fn overwritten (I) | no (O) | MED |
| J12 Deploy guard refusing stale refs + CI/test infra | journey-voice / xokgv1 | `assert-ref-contains-main`, checks.yml, drift check | "deploy workflow now REFUSES a stale ref (**owner request**)" (O) | CI only | no (O) — **its absence is how 10-19 overwrote J1–J11** | LOW–MED |
| J13 Alarm Done/Doing/Backlog/Park via signed token | journey-voice / nsishi (PR #17 open) | HMAC action token, `alarm-action` fn | bug-fix; PR "code, already deployed" (O) | yes; **now broken** (live send-push mints no token) (O) | no (O) | MED |
| J14 FCM dead-token prune | journey-voice / nsishi | Prune UNREGISTERED tokens | none quoted | prune absent live (O) | no (O) | LOW–MED |
| J15 DB maintenance cron; unscheduled-task alarm cancel | journey-voice / nsishi | pg_cron vacuum; clear start alarms | — | live in DB (O) | SQL not on main (O) | LOW |
| get_calendar_events tool | journey-voice / friendly-turing-mlr1bf | Expose synced calendar to Huddle briefs | none found | no (O) | no (O) | LOW |
| React Query persistence | journey-voice / app-load-caching (PR #13 open) | Cache survives reloads | none found | no | no (O) | MED |
| H1 Agent knowledge library | huddle-extension-app / lxia7z (PR #14 open) | Per-agent knowledge packs for 15 agents | **not approved**: "still needs the user's call" (O) | no | no (O) | MED |
| N1a Page-body capture gate (partial state, honest receipt) | nexus-hub / kj5azd (PR #127 open) | Bank partly-successful page captures; count saved, not tried | "why are so many pages not saved?" / "fix everything you've pointed it" (O) | no (O, PR + ledger) | **partly redone** by dfc492cc 10-15 (slug fallback only); partial/receipt absent (O); conflicts in orchestrator.js (O) | MED |
| N1b One real page = one equivalence class | nexus-hub / kj5azd | Page counted once across id/url rows | same request (O) | no | no (O) | LOW–MED |
| N1d Outline draft gate stops refusing over non-content items | nexus-hub / kj5azd | `UNANSWERABLE_BY_ANY_SECTION` + option sets | "**fix immediately as it is blocking me**" (O) | no: "Done, pushed, NOT deployed" (O) | no (O) | **LOW** (one file, no conflict) |
| N2 Course-scoped chat retrieval key fix | nexus-hub / env-setup-agent-scenarios-0jmtoy (behind docs PR #96) | Chat filters chunks by `topic_id` (on 868/868 rows) instead of `course_id` (on 0) | none (agent-found) | no | **no, and the bug is live** at `embaAssistantChat.ts:470` (O) | **LOW** |
| N3 Overridable outline attempt ceiling | nexus-hub / outline-attempts-override (PR #82 open) | Test hook to reach the gate's repair branch | none; PR "raising it rather than taking it" (O) | no (O) | no (O) | LOW–MED |
| QueryClient staleTime 5 min | bridge-builder / app-load-caching-ieosfy | Fewer refetches | none | no | no (O) | LOW |
| E1 Permission-list re-applier (ACT-12) | eds-claude-skills / setup-registration-summary (PR #23 open) | Re-apply allow lists every prompt; never overwrite an unreadable file | none; ledger "still real… OPEN for the owner's call" (O) | no | no (O) | HIGH (stale setup.sh) |
| E2 Push gate requires a terminated rules slice | eds-claude-skills / gate-marker-termination (PR #92 closed unmerged) | A truncated rules file can't switch the branch rule on | none (verifier finding) | no | no (O) | LOW |
| E3 Feasibility studies ship screenshots + fan-out by build output | eds-claude-skills / fanout-partition (PR #93 closed unmerged) | Skill/prose rules | "**Always Provide screenshots for feasibility.**" (O) | n/a (prose) | no (O) | LOW |

**Where the risk sits.** Almost all the HIGH-risk, owner-approved work is in **journey-voice** (J1–J12), and it was **live and then overwritten** by the 10-19 redeploy from main. Elsewhere, four items are small and cheap to bring back, and each is either owner-requested or fixes a live bug: **N1d** (owner: "blocking me"), **N2** (live bug), **E2** and **E3**. android-bridge-template and bridge-builder have nothing of consequence parked.
