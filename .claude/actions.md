# Actions — journey-voice

Persistent checklist of what the owner has asked for, what is open, and the evidence for
anything called done. One ACT entry per request. Pairs with `.claude/memory.md` (which holds
the technical findings) and `.claude/accuracy-log.md` (wrong-first-answers).

---

## ACT-jv-2: PR triage pass — 5 open PRs

**Asked (2026-09-21, owner):** "go ahead with the triage pass" (across all repos with open PRs).

**Status: DONE for 2/5 PRs, 3 left open pending owner review.**

Evidence:
- Full per-PR findings → `.claude/pr-triage-2026-09-21.md` (committed `f2e1c26`).
- #16 merged → `b7cf46d`. #21 closed as superseded → PR comment + close, evidence cites merged #24
  (`54f12c7`).
- #13 (app-load caching), #17 (scheduler trait model), #26 (dryRun harness, 97 files/~29.5k lines,
  much bigger than its title) — real, un-landed, non-stale, but each has genuine merge conflicts in
  actively-evolving files. Left OPEN for the owner's own scoping/merge-vs-reimplement call.

---

## ACT-jv-1: Temporary scheduling caveats — a way to add expiring rules the scheduler obeys until cleared

**Asked (2026-08-26, owner):** a model following existing patterns that allows *temporary*
instructions about when things get scheduled — e.g. "push research-related items to the evening
for now" — explicitly NOT an edit to the core instructions/windows, but an extension holding
temporary rows of caveats the scheduler follows until cleared.

**Owner constraint stated in the same message (standing, applies beyond this ACT):** journey and
Huddle must each run independently OR integrated. Integrated → Huddle handles agents + prioritizing,
journey handles scheduling; each must still be able to do its own on its own.

**Status: DESIGN COMPLETE, NOT IMPLEMENTED — awaiting owner decision on one fork.**

Evidence:
- Investigation + architecture map → `.claude/memory.md` ("Scheduling architecture map +
  temporary-caveats design — 2026-08-26")
- Full design note → `.claude/design-scheduling-caveats.md`
- Correction of the first (wrong-app) answer → `.claude/accuracy-log.md`

Findings that change the shape of the work:
- **ALREADY BUILT:** journey Settings → Scheduling ships an editable "Keyword Detection Rules"
  section (`src/components/SchedulingSettings.tsx:575`). `research → evening` is addable today with
  no code. Only the *temporary/expiring* half is missing.
- Core module is `supabase/functions/_shared/scheduling-defaults.ts::resolveConfig` — four consumers.
- `evening` is an existing named window = 19–22, all 7 days.

**[SETTLED 2026-08-26] Both forks answered by the owner.**
1. Caveats **re-place** already-scheduled tasks (nightly rebuild moves them), not new-only.
2. Overflow = **relax** — anything that will not fit the caveat's window falls back to the regular
   placement rules *as if the caveat never existed*.

ACs written: `.claude/ac-scheduling-caveats.md` (10 criteria + feasibility table). Status: awaiting
go-ahead to implement.

**Key finding that shrank the work:** `nightly-schedule-builder:1203` ALREADY walks `preferredWindows`
in order and falls through on exhausted capacity, so "relax" needs no overflow code — a caveat just
PREPENDS its windows to the ordered list. Note the trap: a keyword override does
`preferredWindows = [win]` (replaces → hard constraint, task goes unplaced when full), which is the
opposite of relax. A caveat must prepend, never replace. Two real regressions are covered by AC-7
(aggregate-fit eligibility must be judged on the BASE list, since prepending changes its length) and
AC-2's guard (a caveat must never reduce the number of tasks placed).

---

## Open items surfaced during this investigation (NOT requested — do not action without sign-off)

- **[OPEN — gap] Keyword rules bind on the nightly path only.** Full `contextRules` sweep:
  `execute-tool` / `batch-calendar-scheduler` / `smart-calendar-scheduler` call `resolveConfig`, which
  does not return `contextRules`, so keyword window overrides do not apply on ad-hoc/agent scheduling.
  Closing this falls out naturally if caveats land in the shared module.
- **[DONE 2026-08-26] Frontend↔backend window parity — `after_work` Saturday.** `after_work.days` was
  `[1,2,3,4,5]` in `_shared/scheduling-defaults.ts` vs `[1,2,3,4,5,6]` (incl. Saturday) in
  `src/config/schedulingRules.ts`, despite the "must stay in sync" contract. Owner settled which side
  was right: *"afterwork should not include Saturday"*. Frontend default corrected to `[1,2,3,4,5]`.
  Evidence: `tsc --noEmit` clean; both files now read `[1, 2, 3, 4, 5]`; `PROF_EDUCATION`/`VENTURES`
  still pair `after_work` with `weekends` so no category lost Saturday coverage. Deliberately did NOT
  touch `end: 22` — the owner's stored row has `end: 19`, which is their own setting.
  **Scope:** affects new users, Settings "Reset to defaults", and pre-load renders only — the owner's
  stored row already excluded Saturday (verified against `user_scheduling_prefs`).
- **[OPEN — guard] A parity test between `src/config/schedulingRules.ts` and
  `supabase/functions/_shared/scheduling-defaults.ts`.** The "must stay in sync" contract is a comment,
  and it drifted. Per the org rule, this earns a deterministic check, not another prose line. Not built
  — needs sign-off.
- **[OPEN — trap, documented] `resolveConfig` prefers `userConfig.timeWindows` WHOLESALE.** A code-default
  fix is invisible to any user who has ever saved their windows. Any future "fixed the default" claim
  must be verified against the stored row, not the source file.
- **[OPEN — design, mirrored from huddle `.claude/actions.md`]** Integration toggle: exactly one driver
  when integrated (journey = natural driver); Huddle consumes but retains the equivalent engine for
  journey-off. The caveat record is the portable contract between the two sides.


## ACT-jv-2 — temporary scheduling caveats: IMPLEMENTED (2026-08-27)

Owner rulings applied: caveats RE-PLACE already-scheduled tasks; overflow **relaxes** to the regular
rules "as if the caveat never existed"; `after_work` excludes Saturday (shipped earlier, `e389201`).

**Extends the ONE core system** — `supabase/functions/_shared/scheduling-defaults.ts::resolveConfig`,
which all four schedulers import. No parallel resolver was created.

- `SchedulingCaveat` / `activeCaveats()` / `caveatMatches()` / `applyCaveats()` in the shared module.
- Wired into `nightly-schedule-builder` placement: caveat windows PREPEND to the ordered preference
  list, so the existing fall-through loop delivers "relax" with **no overflow code written**.
- **AC-7 handled:** the aggregate-fit gate now keys on `baseWindowCount`, not the caveat-modified
  length. Prepending changes `preferredWindows.length` and would otherwise silently disqualify a task
  that qualified without a caveat.
- **Zero migration.** `user_scheduling_prefs.config` is already JSONB, so `config.caveats` needs no DDL.
- **Round-trip bug found and fixed:** `mergeSchedulingConfig` rebuilds the config object explicitly,
  so it would have DROPPED caveats on every save — wiping the owner's active caveats the moment they
  touched any other setting.

**Guard: `src/utils/schedulingCaveats.test.ts`, 9 tests, MUTATION-PROVEN (5/5 classes).** The decisive
one: flipping prepend→REPLACE (the keyword-override shape) fails 3 tests. That is the bug the naive
implementation would have shipped — a task whose single caveat window is full gets dropped entirely
instead of relaxing.

### DECIDED 2026-08-27 — owner ACCEPTED the jitter (was: open decision)

**A caveat can change GLOBAL placement count by ±1 task.** Measured over 4000 fixtures: **1.4% place
one fewer, 1.4% place one more, 97.2% identical; worst case one task either way.** Cause: greedy
first-fit is order-sensitive, so reordering preferences changes what packs. This is inherent to ANY
preference change — the existing `contextRules.keywords` overrides behave identically.

The owner's stated rule is PER TASK ("any research that would not fit the slot should fall back to
the regular placement rules") and that holds exhaustively — asserted and mutation-proven. The
stronger global invariant I originally drafted into the ACs is NOT achievable with a pure prepend.
It was corrected in the open rather than weakened quietly.

**If the ±1 is unacceptable:** a day-level fallback (if the caveat pass places fewer, use the
no-caveat placement for that day) eliminates it, at the cost of a second placement pass per day and
the caveat occasionally doing nothing for a whole day. Not built — needs sign-off.

### Surfacing — BUILT 2026-08-27 (owner said yes)
- **Settings → Scheduling → Temporary Caveats** (`SchedulingSettings.tsx`). Placed ABOVE Keyword
  Detection Rules, because a caveat overrides what those rules would otherwise do. Shows each
  caveat's plain-English text, what it matches, which windows it prefers, and whether it expires or
  runs until cleared; expired ones render as "expired — no longer applied" rather than vanishing.
- **Three agent tools** (`_shared/tool-definitions.ts` + `execute-tool`): `set_scheduling_caveat`,
  `list_scheduling_caveats`, `clear_scheduling_caveat`. The set tool REJECTS an invented window name
  rather than storing a caveat that can never match — a caveat that silently does nothing is the
  worst failure here, because the user believes it works. Tool descriptions steer temporary language
  ("for now", "this week") to a caveat and permanent changes to Settings.
- **Duplication removed:** the handlers' expiry check delegates to the shared `activeCaveats()`
  instead of re-implementing it. Two copies would drift, and the scheduler and the tool disagreeing
  about which caveats are live is the hardest version of this bug to see.
- **New guard, mutation-proven (3/3):** tool vocabulary vs the real `DEFAULT_TIME_WINDOWS`. Proven by
  dropping a real window, inventing a fake one, and renaming a window without updating the tool.
  Suite now 10 tests. `tsc --noEmit` clean.
- Visualization of the ±1 jitter for the owner's decision:
  https://claude.ai/code/artifact/2656015e-c032-4d5f-bbb4-1f57b809b307

### STILL NOT BUILT (needs sign-off)
- Applying caveats on the ad-hoc paths (`execute-tool` / `batch-` / `smart-calendar-scheduler`) —
  they call `resolveConfig` but do not consume `contextRules` either; same pre-existing gap.


**Resolution of the ±1 jitter (2026-08-27).** Owner reviewed the measurement + both worked examples
(artifact 2656015e) and **accepted it**; the day-level fallback was explicitly declined. Full finding,
the numbers, the rejected alternative and the reason are in `.claude/memory.md` under
"DECISION (owner, 2026-08-27)". Made self-explaining at runtime: a rejection while caveats are active
is now `reason: 'no_window_capacity_caveats_active'` and the run log states the tradeoff and the
remedy, so the eventual "why wasn't this scheduled?" answers itself without anyone remembering this
conversation.


## ACT:digest-delivery-journey — three morning digests, journey side (2026-09-13)

**Origin:** owner request — an 8am brief (schedule + current ranking + widget deep link), a meetings
digest (with-a-person, today + 7 days by day), and Terry's stand-up delivered like the others.
**Owner ruling:** both apps standalone; integrated ⇒ journey is source and switch.

**Status: IMPLEMENTED + PUSHED on `claude/huddle-workflows-setup-cucecs`. NOT merged, NOT deployed,
NOT live-confirmed.** ACs `.claude/AC-digest-delivery.md` (45, subagent-authored before code).
83/83 tests; 12/12 mutations FIRED across four lanes.

**BLOCKING before anything delivers:**
- `supabase secrets set APP_BASE_URL=https://<app-host>` + add to `deploy-supabase-functions.yml`
  secret sync. No default by design — digests fail closed.
- The meetings **migration is written and deliberately UNAPPLIED**, so AC-MTG-1's DB read-back is
  unobserved.
- After deploying the `$select` change: `update calendar_connections set sync_token = null;` —
  prospective only, because all 6 rows are already NULL.

**NOT REACHED:** the multi-select CONTROL (`VoiceAssistantSettings.tsx:862` — the brief named the
wrong file; `NotificationSettings.tsx` holds the already-multi-select global channel prefs); the
digest renderer's live wire-up at `notification-delivery:239` (one line, written verbatim in
`IMPL-digest-builder.md`); independent verifier for the journey lanes.

### Live defects found while doing this — OUT OF SCOPE, owner not yet asked
- **Delta sync is not incremental.** All 6 `calendar_connections` rows have `sync_token = NULL`
  while rows sync daily, so every sync takes the full-fetch branch. `update_calendar_sync_token`'s
  result is UNCHECKED at both call sites — a silent failure would look exactly like this.
- **Three more UTC-vs-user-timezone defects** in `notification-scheduler` — `:202` quiet hours,
  `:280` due-today 9am, `:337` overdue 9am. Identical class to the digest bug just fixed.
  `shouldSendAtLocalHour` is exported; one-line swap each.
- `nightly-schedule-builder:432,:717` still inline their own `7` rather than importing
  `MEETING_HORIZON_DAYS`.

---

### ACT:digest-delivery-journey — UPDATE 2026-09-13 (second pass)

**Status: still on `claude/huddle-workflows-setup-cucecs`, pushed. NOT merged, NOT deployed, NOT
live-confirmed.** 150/150 tests; 12/12 mutations FIRED this pass (23/23 cumulative across lanes).

**Closed since the entry above:**
- ✅ **Multi-select CONTROL** — `VoiceAssistantSettings.tsx` now writes `commsModes` from a checkbox
  popover. The backend had resolved the array since the channel lane; only the control was single.
  The last checked channel cannot be unchecked (a call with no channel schedules and delivers nowhere).
- ✅ **`notification-delivery` wire-up** — the scheduled-call body is `renderScheduledCall(...)`,
  not the phone script interpolated into every channel. Mutation FIRED.
- ✅ **The owner's source ruling has a home** — `_shared/digest-source.ts`. Standalone ⇒ journey
  answers all three; integrated ⇒ journey keeps the day plan and the calendar and pulls only the
  stand-up. Mutation FIRED.
- ✅ **Digest 3 (Terry's stand-up) is no longer chat-only** — Huddle's `runScheduledStandup` returns
  `result.digest` and accepts `deliver:false`; journey pulls it over the existing
  `JOURNEY_PROXY_TOKEN`. 3 mutations FIRED (2 Huddle-side).
- ✅ **Digest 2 (meetings)** — `_shared/digest-source-meetings.ts`, wired into `send-digests`.
  6 mutations FIRED.
- ✅ **`send-digests` exists** — the caller that was missing. Channels grouped by rendered body;
  per-channel result read rather than "no transport error"; 503 on a missing `APP_BASE_URL`.
- ✅ **Morning Kickstart back to 08:00** — it was at **15:21** (`user_scheduling_prefs`, user
  `a3378f93-…`, `scheduled_calls[7]`). This is the session's ONLY live change.

**ROOT CAUSE of "I get no digests", found this pass:** `notification-scheduler`'s
`generateDailyDigest` reads the channel preference into `userChannels` at `index.ts:523` and NEVER
USES IT — `send-push-notification` is invoked unconditionally. Switching the setting to email could
not have worked on any run, for anyone. `send-digests` is the replacement path.

**STILL OPEN:**
- ⏳ **Digest 1 (daily brief) source** — `_shared/digest-source-daily.ts`, lane in flight. Its slot
  in `send-digests` is marked NOT YET WIRED in the file itself.
- ⏳ **Independent verifier** for the journey lanes (batched, after the daily lane lands).
- ⏳ One mutation deferred: `digest-source-standup.ts` "fails closed BEFORE the network call". It
  returned PRE-DIRTY because a background lane was mid-write on a file in the `src/utils/*.test.ts`
  glob. Nothing was proven; re-run once the tree is quiet.
- ⏳ Cron trigger for `send-digests` (every 15 min) not yet added.

**BLOCKING, owner action (unchanged and now harder-gating):**
- `supabase secrets set APP_BASE_URL=https://<app-host>` — every digest fails closed without it.
  `send-digests` returns 503 rather than emailing a dead relative link.

---

### ACT:digest-delivery-journey — UPDATE 2026-09-13 (verifier loops 1 + 2 closed)

**Verification: loop 1 (6/10 claims, killed mid-run) + loop 2 (14 CONFIRMED / 1 REFUTED / 0 NOT
REACHED, 7 min of a 25-min budget). Artifacts `.claude/VERIFY-digest-delivery-loop{1,2}.md`.**
175/175 tests. 31/32 mutations FIRED cumulatively; the 32nd reported INERT (behaviourally
equivalent → NOT PROVEN, not passed).

**Every loop-2 finding, and what happened to it:**
| # | Finding | Outcome |
|---|---|---|
| 1 | commit `f5556e4` certified a prose fix it did not make | FIXED `4de2964` — the comment now says journey cannot produce a stand-up alone |
| 2 | `meetings.test.ts` outside the `npm test` glob (ran by hand only) | FIXED — glob now includes `supabase/functions/_shared/*.test.ts` |
| 3 | `handleToggleCallCommsMode` untested (the one unprovable claim) | FIXED — extracted to `src/utils/commsModes.ts`, 9 tests, 3/3 mutations FIRED |
| 4 | `mutate.sh` matcher still armed for the next caller | FIXED in eds-claude-skills PR #89, 3 regression cases, 28 guard suites green |
| 5 | "`app_message` script leak still open" | **NOT A DEFECT — verifier misread the mechanism.** See below |
| 6 | `tsc` typechecks no edge function | ACKNOWLEDGED, see below |
| challenge | the `send-digests` loop is untested and cheaply extractable | DONE — `_shared/digest-run.ts`, 12 tests incl. a brute-forced completeness sweep, 3/3 mutations FIRED |

**Finding 5 REJECTED after grounding — do not "fix" this again.** The verifier reported
`notification-delivery:245-258` as the same verbatim script leak as the email path. It is not.
- Email/Slack (the real defect): `callConfig.context` was concatenated **directly into `body`** and
  shipped verbatim — a phone script reached a human unchanged.
- `app_message`: `context` → `buildCallContext` → `contextualInstructions` → `userInput` to
  `hybrid-assistant-api` with *"Generate your opening message for this check-in based on the context
  above"* (`send-chat-message/index.ts:517`). The user receives the **LLM's generated message**.
That is an LLM-generation path by design — the same role the script plays on a phone call — not
verbatim delivery, so AC-REND-1 is not breached there.

**Finding 6 stands and is worth knowing:** `tsconfig.app.json` includes `src` only, so `npx tsc
--noEmit` typechecks **no edge function**. A green `tsc` reads as coverage it does not have. The
widened test glob partly compensates (`_shared/*` is now imported by the node suite, which does
typecheck-by-execution), but `supabase/functions/*/index.ts` remains unchecked by anything —
which is exactly how a raw NUL byte survived in `send-digests/index.ts` through a green suite.

**STILL BLOCKING, owner action:** `supabase secrets set APP_BASE_URL=https://<app-host>` + add to
the `deploy-supabase-functions.yml` secret sync. Every digest fails closed without it.

---

### ACT:digest-delivery-journey — DEPLOYED 2026-09-13, TWO LIVE BLOCKERS REMAIN

**All three repos merged to `main` and deployed. Verified against the LIVE project, not against a
green checkmark.**

| What | Proof |
|---|---|
| `send-digests` live | status ACTIVE, `verify_jwt:false`; bundle contains `runDigestsForUser`, `digestRunIsComplete`, `standup_requires_huddle` |
| script-leak fix live | `notification-delivery` v521 ACTIVE; `renderScheduledCall` present, old verbatim interpolation ABSENT |
| cron live | `cron.job` row `send-digests-job` `*/15 * * * *` active — applied by MCP, NOT by the deploy workflow |
| pipeline runs | pg_net probe → HTTP 200, `{"ok":true,"integrated":true,"users":26}`, every user skipped with a reason |

**THREE deploy defects found and fixed (`06147c9`), all of which let a green run ship less than it
claimed:**
1. `paths:` trigger reads the whole push; the deploy diffed `HEAD~1..HEAD`. A merge whose LAST commit
   touched no function deployed NOTHING and reported success. Measured: `send-digests` absent from the
   live project after a green run.
2. `fetch-depth: 2` made the push range unavailable to that diff.
3. `grep -v '^_'` stripped `_shared/`, so a pure `_shared` change deployed nothing while every
   consumer BUNDLES it — they would have run the old copy indefinitely.

**Pre-existing, NOT caused here, NOT fixed here:** `function_name: all` cannot succeed on this project.
The `mcp` function bundles to **26 MB** and Supabase returns `413 request entity too large`; the deploy
loop is alphabetical and exits on first failure, so nothing after `m` ever deploys. Worked around by
deploying the 8 changed functions individually. **Any future full redeploy is blocked until `mcp` is
shrunk.**

**BLOCKER 1 — `APP_BASE_URL` unset.** Every digest fails closed without it (no default, by design).

**BLOCKER 2 — the owner's channels contain no EMAIL.** `notification_prefs` for
`a3378f93-…` (dev@enterpriseds.io): `daily_digest_enabled: true`, but
`channels = {GOOGLE_EVENT, OUTLOOK_EVENT, PUSH}`. `selectDigestChannels` maps the two calendar-event
channels to NO render target (correct — you deliver to them, you never render one), leaving `PUSH`
only. **So the digest would arrive as a phone push, not the 8am email requested.** This is the
original symptom, and its cause is data, not code.
**Not changed unilaterally:** `notification_prefs.channels` is ALSO read by
`notification-delivery:673` for batched task reminders, so adding EMAIL there starts emailing every
task reminder too — a side effect the owner did not ask for. Real fork, put to the owner.

---

### ACT:digest-delivery-journey — STOOD DOWN 2026-09-13 at the owner's direction

**`send-digests-job` is UNSCHEDULED. Nothing from this work runs on a timer.** Live `cron.job` is
back to its five pre-existing entries (`drain-huddle-turns`, `nightly-schedule-builder`,
`notification-delivery`, `notification-scheduler`, `run-scheduled-ceremonies`).

**Owner's correction, and it was right on both counts:**
> *"you broke it by doing something that requires a supabase secret update. I asked for nothing new
> and for supabase to be skipped if can be helped given the azure migration... digests weren't
> failing when initially created."*

- **Nothing was broken.** Measured: `daily_digest` 7 created / 7 delivered / 0 failed over 7 days;
  `weekly_digest` 1/1; every cron HTTP 200. The pre-existing digest path was never touched.
- **`APP_BASE_URL` should never have existed.** Its justifying comment claimed "journey has no
  absolute base URL anywhere (verified: zero repo-wide hits for APP_URL / PUBLIC_URL / VITE_APP_URL
  / SITE_URL)". That grep searched variable NAMES, never the VALUE, which sat in
  `public/bridge.config.json:4` (`https://journey-voice.lovable.app`), `bootTrace.ts:50` and
  `dailyReviewPipeline.ts:609`. Fixed in `e0cd7fd`: the published host is the default, the env var
  is an optional override (the `HUDDLE_SYNC_URL` shape). **No secret is required by anyone.**

**KNOWN BROKEN, do not re-enable the cron without fixing this first:** a live run returned
`[digest-source-meetings] event query failed: column external_calendar_events.attendees does not
exist`. The table has 16 columns and carries NO `attendees` and NO `show_as`. The meetings digest
cannot work without a schema migration — which is exactly the Supabase work the owner has ruled out
during the Azure migration. The daily-brief and stand-up lanes also returned `partial_or_failed` at
delivery and were never root-caused.

**To resume later (one statement, after the schema question is settled):**
`supabase/migrations/20260913170000_send_digests_cron.sql` re-creates the job verbatim.

---

## ACT:task-status-mapping — task creation silently failing. SHIPPED AND LIVE 2026-10-08.

Owner, 2026-10-06: *"It is also failing to create tasks on the board with no clear cause after
asking for two tasks to be created back to back"*, then 2026-10-08: *"Approved, fix the prompt and
SmartTaskInput and cleanup"*.

| # | What | State | Evidence |
|---|---|---|---|
| 1 | `ai-task-parser` prompt — BOTH blocks told the model to set `status` = `category` | **LIVE** | PR #28 → `0920e1c`; deploy of `b272540` succeeded; deployed fn is **version 560, ACTIVE**, source read back and carries the fix |
| 2 | `SmartTaskInput.tsx` — `mapCategoryToStatus()` deleted | **LIVE** | PR #28 |
| 3 | `TaskCreationModal.tsx` — a byte-identical copy of that helper (`:620`) plus a hardcoded `status:'PROF_EDUCATION'` (`:943`) | **LIVE** | PR #28; found by the repo-wide sweep, not in the original two |
| 4 | Data cleanup, 11 rows | **DONE** | 10 → `BACKLOG`, `8e1b45a4` → `UP_NEXT`, category preserved; post-state verified 0 remaining |
| 5 | Deploy fix — backticks closed the prompt template literal | **LIVE** | PR #29 → `b272540`; reproduced the parse error, proved the fix |
| 6 | Guard — `parse-edge-functions.yml`, the repo's first `pull_request` check | **LIVE** | PR #29; mutation-proved FIRED |
| 7 | Stale comment telling the next reader to reinstate the defect | PR #30 open | `315c84b` |
| 8 | Huddle: log journey's real refusal reason instead of dropping it | **MERGED** | huddle PR #64 → `eba25f0` |

**NOT YET USER-CONFIRMED.** Every mechanism above is verified — the deployed function source was
read back, not inferred — but the owner has not created a task in the app since. Per the standing
rule this stays "implemented, mechanism verified, NOT confirmed live" until they report back.

### Open, deliberately not done
- **Four near-duplicate pairs** among those 11 ("Build **a** responsive Geo-AI…" / "Build
  responsive Geo-AI…", "AppBuilder **App**" / "**app**", "Research AI-assisted SDLC" / "…SDLC
  **practices**"). The cross-turn dedup normalises titles but not case or trailing-word variants.
- **`todayStr` UTC/local off-by-one** (`ai-task-parser` ~:344): `new Date('2026-10-08')` parses as
  UTC midnight while `.toDateString()` renders local, so "is this for today → `UP_NEXT`" can be a
  day out for a user behind UTC. Pre-existing, behaviour change, out of scope.
- **UNRESOLVED, recorded as unknown rather than guessed:** the lane query grouped by `boards.name`,
  not `boards.id`, so "123 `VENTURES` lane rows" cannot distinguish *123 boards with one lane each*
  (benign — the seed migration `CROSS JOIN`s every default board) from *one board with 123 duplicate
  lanes* (~1,627 columns on the Dashboard board, a visible defect). One `group by board_id` settles
  it.
- **Original request #3, still never started:** a settings page to add calendars to be monitored —
  *"my University of michigan inbox is not currently being monitored"*.

### ACT:task-status-mapping — REOPENED and re-shipped the same day

Item 1-8 above were reported done. They were not: the **main** writer was still live.

| # | What | State | Evidence |
|---|---|---|---|
| 9 | `smart-calendar-scheduler` PRIORITY 3 returned `mapping.defaultStatus` (a CATEGORY); `taskScheduling.ts:133` wrote it to `tasks.status`. **This, not the parser, produced the 11 rows** — they would have returned on the next scheduling pass | **LIVE** | PR #31 → `3c30427`; deploy run `37803250420` success, log reads `✅ smart-calendar-scheduler deployed` to project `wwxgajrtmslzklnyplah` |
| 10 | Guard `src/utils/workflowStatus.ts` + test — nine real lanes, the four category-shaped enum members deliberately omitted | **LIVE** | PR #31; `mutate.sh` **FIRED**; 179/179; `tsc` 0 |

**Found by accident**, grepping `PERSONAL` for an unrelated product question. My sweep had grepped
the helper NAME and a LITERAL; this site assigns a VARIABLE holding a category, which neither
pattern can match. Logged in `.claude/accuracy-log.md` with the guard it earns: sweep the
**assignment target** (`status[:=]`), never the value.

### Open decision for the owner — `PERSONAL` vs `LIFE`

Owner, 2026-10-08: *"I don't think one of either personal or life should have exist."* Correct, and
`PERSONAL` is worse than redundant — it is settable by agents and invisible to the category filter.
Three options put to them; **recommended A: retire it** — drop it from the two agent tool enums,
map any existing row to `LIFE`, leave the DB enum value in place (inert, so re-enabling is one
line). Not actioned: it is a product call, and nothing is bleeding while it waits.

### Also open
- **Dead UI:** `SchedulingSettings.tsx:506` still offers a per-category `defaultStatus` editor that
  now affects nothing. Either remove the control or make it offer real workflow lanes.
- **Three stale copies** of the category→status map remain (`_shared/scheduling-defaults.ts:39-44`,
  `src/config/schedulingRules.ts:121-147`, `smart-calendar-scheduler:261-265`), unread for status
  purposes but a landmine for the next reader.
- Still outstanding from before: the four near-duplicate task titles, the `todayStr` UTC/local
  off-by-one, the `boards.name`-vs-`boards.id` lane-count question, and **original request #3, the
  calendar-monitoring settings page**, which has never been started.

| # | What | State | Evidence |
|---|---|---|---|
| 11 | **`RealtimeVoiceAssistant.ts:1676`** wrote `status: normalizedCategory` into a real `.insert([taskData])` — every task created BY VOICE. A SIXTH writer, and the likeliest origin of the 11 rows (their titles are dictated work items) | merged | PR #33 → `e7588ed`; re-swept clean; tsc 0; 179/179 |
| 12 | `RealtimeVoiceAssistant.tools.backup.ts` — no importers (verified), annotated not changed so it can't be restored as a working copy of the defect | merged | PR #33 |
| 13 | `assignmentFetching.ts` ×3 — verified NOT writers (no `.from('tasks')`, consumer uses them as context, engine only compares `'DONE'`), changed to `BACKLOG` to remove the decoy | merged | PR #33 |

**THE `EDUCATION → PROF_EDUCATION` TERNARY IS WHY #11 SURVIVED SIX YEARS OF THIS CODEBASE.**
`EDUCATION` is not a `task_status` member, so without the special case the insert would have failed
loudly. It silenced the error without fixing the mapping — a loud failure became a quiet wrong
value.

### What is verified live vs what needs the owner

| Layer | Status |
|---|---|
| `ai-task-parser`, `smart-calendar-scheduler` (edge fns) | **LIVE, verified** — deploy runs succeeded; the parser's deployed source was read back (v560 ACTIVE) |
| `SmartTaskInput`, `TaskCreationModal`, `taskScheduling`, `RealtimeVoiceAssistant` (client) | **MERGED to `main`.** NOT verifiable from here: nothing in Actions builds `src/` — journey's client is a **Lovable** app deployed outside GitHub. The owner hard-refreshing and creating a task is the only confirmation |

## ACT:personal-category-label — the shown word is now "Personal". MERGED 2026-10-12.

Owner, 2026-10-12: *"Read to see where we would need to change life in scripts and filters to swap
life and persona terms?"* — a survey request; the survey is in `.claude/memory.md`.

| # | What | State | Evidence |
|---|---|---|---|
| 1 | Survey: all 153 `LIFE` occurrences in journey (51 files) + ~24 in Huddle, bucketed by surface — enums, defaults, colour/label maps, pickers, prompt text, tool enums, lane definitions, and the CSS token `--category-life` | **DONE** | recorded in `memory.md` |
| 2 | Nine CATEGORY labels → "Personal" | **MERGED** | PR #35 → `833d650`; tsc 0; 179/179; codepoint-scanned all 7 files for smart quotes |
| 3 | The `value`/`path` literals and the four status/lane labels left alone, deliberately | **MERGED** | reasons in the PR body and `memory.md` |

**NOT verifiable from here** — `src/` only, and journey's client deploys via Lovable, not Actions.
Status is "merged, mechanism sound, NOT confirmed live" until the owner hard-refreshes.

### Open decision for the owner — retire the five empty category lanes?

Measured 2026-10-12: `LIFE`, `CAREER`, `VENTURES`, `PROF_EDUCATION` and `PLANNING` each have **123
lane rows and ZERO tasks in them** — 615 empty columns across the boards, and the reason the
Dashboard board still shows a lane headed "Life". Deleting them moves no task. It is still a
615-row delete against the live board and a visible change, so it waits on the owner. Put to them
2026-10-12; not actioned.

### Also still open
- **`PERSONAL` as a settable value** — reachable only via the agent tool enums
  (`tool-definitions.ts:48,270`) and invisible to the category filter. Recommended: drop it from
  those two enums. Unchanged by #35, which touched labels only.
- The dead `defaultStatus` control (`SchedulingSettings.tsx:506`); the four near-duplicate task
  titles; the `todayStr` UTC/local off-by-one; the `boards.name`-vs-`boards.id` lane-count
  question; and **original request #3, the calendar-monitoring settings page**, never started.

| # | What | State | Evidence |
|---|---|---|---|
| 4 | `.claude/memory.md` header read `Last updated: 2026-09-21` while carrying 2026-10-08 and 2026-10-12 sections. Stamped, with a note to trust per-section dates over the file-level one | **MERGED** | PR #37 |
| 5 | Ledger commits verified to exist against `origin`, not a local tree: `git cat-file -t` returns `commit` for both `833d650` (#35) and `4576ea5` (#36) | **DONE** | `4576ea5` is `origin/main`'s tip |

## ACT:empty-board-cleanup — boards of zero-task users deleted. DONE 2026-10-15.

Owner, 2026-10-15: *"those users are from a different app i built. first, dropp all the ones that
have 0 tasks"* then *"dont ever drop von.ellis@, go with option A"* — Option A = delete only the
journey **boards** (lanes cascade) of zero-task users; never `auth.users`, never anything of
`von.ellis@enterpriseds.io`.

| # | What | State | Evidence |
|---|---|---|---|
| 1 | `delete from public.boards` where the owner has 0 tasks, no task points at the board, and the owner is not von.ellis@ | **DONE** | 28 boards / 23 users deleted (created 2026-02-07..2026-03-13); 120 lanes cascaded |
| 2 | Post-state | **VERIFIED** | boards 176→148; tasks **446 unchanged**; von.ellis@ boards 1; only remaining zero-task user with a board is von.ellis@ |
| 3 | Demo user `00000000-…0001` (14 tasks) **not** touched — fails the 0-task condition | **VERIFIED** | both boards present: "Test Board" (14 tasks) + "Personal Tasks" (0) |

### Found while doing it — dev@enterpriseds.io has 145 boards (NOT actioned, awaiting owner)

`KanbanBoard.tsx fetchBoardColumns` looks up the board with `.eq('is_default', true).maybeSingle()`.
`maybeSingle()` THROWS on 2+ rows, and the `catch` calls `createDefaultBoardAndColumns()`, which
inserts ANOTHER `is_default=true` board — so once two defaults exist, every board-view load adds
more. Measured: 145/145 of dev@'s boards are `is_default=true`; the first (2025-09-25) holds 425 of
432 tasks, one from 2026-02-03 holds 7, the other 143 are empty; the second board appeared
2026-01-29; 49 same-second pairs (the view loads twice per visit — cause unconfirmed). Proposed to
the owner: fix the lookup + delete dev@'s 143 empty boards. Not started.

## ACT:board-default-lookup — stop the duplicate-board loop. Owner: *"the new option a"* (2026-10-15)

| # | What | State | Evidence |
|---|---|---|---|
| 1 | Every single-row board read (11 client sites, 7 edge-fn sites) takes the OLDEST board: `.order('created_at', { ascending: true }).limit(1)` — the shape the MCP `create_task` path already used | **MERGED** (see PR) | `boardLookup.test.ts` 3/3; suite 182/182 |
| 2 | `KanbanBoard` no longer creates a board inside its `catch`; a lane-less board gets lanes, not a second board; `Calendar` no longer creates on a read error; `demoData` resolves oldest (was newest) | **MERGED** | same |
| 3 | Guards mutation-proved with `mutate.sh`: order removed (KanbanBoard) FIRED; create-in-catch reinstated FIRED; order removed (twilio edge fn) FIRED; sourceHygiene `.tsx` regex fix reverted FIRED | **DONE** | 4/4 FIRED, all restored to HEAD |
| 4 | Data: deleted 145 empty boards (144 dev@, 1 demo `00000000-…0001`), never the oldest board, never a board a task points at, von.ellis@ excluded by name; 1,479 lanes cascaded | **DONE** | boards 149→4; tasks **446 unchanged**; 0 orphan tasks |
| 5 | dev@'s 7-task board set `is_default=false` so the OLD live client stops looping before Lovable ships the fix. Reversible: `update boards set is_default=true where id='14e07332-94f3-493d-9644-849e6b642e74'` | **DONE** | 0 users with 2+ defaults |
| 6 | Loop was still live at fix time: dev@ gained board #146 at 2026-10-15 16:56 UTC | observed | |

**Client half NOT confirmed live** — journey's `src/` deploys via Lovable, outside Actions. Edge fns
deploy on merge. The 7 tasks on dev@'s second board stay where they are (not moved — not asked).


## ACT:kickstart-email-dupes — "no meeting schedule email; emails empty and duplicated" (2026-10-15)
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Calendar sync stored nothing since 09-13 (PGRST204 `attendees` column missing; migration 20260913140000 never applied) | applied live | post-apply delta sync: +8 / +2 events |
| 2 | Kickstart ×3 / Business ×2 per day: `schedule_next_call` re-booked each duplicate | applied live (`schedule_next_call_dedupe`), 4 pending dupes deleted | rolled-back probe: 2 calls → same id, 1 row |
| 3 | Email body: rest of today's meetings added to the briefing | merged #44 (275ecc4), deploy run 38775916287 | npm test 194/194; AC-M2/M3 mutations FIRED |
| 4 | Iris 8am/8pm brief silent since 10-06 | huddle #73 (7b0656a) | see huddle actions |

**NOT confirmed live by the owner yet** — next check is tomorrow's 8:00 ET email (expect ONE email with a meetings section).
| 5 | ALL emails 401'd after 15:00: main's send-unified-notification lacked `x-webhook-secret` (only on unmerged branch a0c87e7) | merged #46 (6d42c86), deploy run 38780447213 | live test 17:44 -> 401; after deploy, test 17:52 -> relay 200, delivered_at set; guard AC-AUTH-1 mutation FIRED |
| 6 | Iris brief live test (morning edition, real send) | delivered | chat.pending_turns schedule-brief-morning-2026-10-15-manual-…: done; FCM push 1 success; owner screenshot 1:43 PM |

**Live-tested 2026-10-15 ~1:50 PM ET; owner to confirm the 1:52 PM "Test-Morning Kickstart" email arrived.**
| 7 | Owner: "show meetings for the day and a section for the rest of the work week" | merged #49 (ad1a751), deploy run 38782253228 | live test 18:04 listed Haircut + Test Event 1; SUPERSEDED by row 8 |
| 8 | Owner: "where are the tasks scheduled for that day?" + "show the window, rest of the day, and then the next 7 days (as available)" | merged #50 (b53fbca), deploy run 38786859013 success | live test 18:38 UTC: graph 202, delivered_at set; body = "This window — morning, 6 AM–9 AM: nothing scheduled" / "Rest of today (2 meetings, 11 tasks)" / "Next 7 days (0 meetings, 39 tasks)" by day; npm test 201/201; tomorrow's window_morning still 1 pending row after the test (dedupe held) |

| 9 | Owner: "Meetings should be pulled out separately from the tasks ... their own summary section" | merged #53 (1e0d9ad), deployed | every section: Tasks (n) then Meetings (n); "Meetings: none." only when the read succeeded; 201/201, guards FIRED |
| 10 | Owner: "It should be a rich clean email format" (approved preview: "I love it!") | merged #55 (93aede9); worker run 38793512485 + functions run 38793512387 success | renderBriefingHtml (inline-styled tables, escaped); send-unified POSTs html to /notify; worker sends contentType HTML; npm test 266/266; AC-N-HTML / AC-H2 / AC-HTML-RELAY FIRED. Live test 19:50 UTC graph 202 (19:25 test raced the deploy: functions updated 19:25:45). **NOT yet confirmed in the owner's inbox** |
| 11 | TRAP removed: the live Worker (/notify, /slack/events) had been deployed from unmerged branch claude/huddle-journey-integration-xokgv1 (4ed84fc); main had no /notify, and a push to main under cloudflare/** would have deployed a worker that 404s every email | ported byte-identical in #55 (15 files cmp'd) | main now == live + HTML |

**Format live-tested 2026-10-15 2:38 PM ET; NOT yet confirmed by the owner in their inbox.** Iris meeting list still blocked on Huddle Graph Calendars.Read (Exchange RBAC steps, owner action — huddle ACT:schedule-brief-403).

## ACT:alarm-sound-any-file — custom alarm sound "doesn't stick" + pick any mp3 (2026-10-15)

**Asked:** why the alarm sound picked in Settings plays on the Test button but not on the real full-screen
alarm; why only Android's built-in sounds can be chosen. Then: "go ahead and add the mp3 solution".

**Findings (observed):** the real alarm's first ring was the notification channel's fixed sound
(Android default) until android-bridge-template `f8d4cc1` (Journey APK v1.0.6, 2026-10-12) moved it to
AlarmSoundService. The alarm log (`activity_log`, `android_alarm_trace`) shows 58 full-screen alarms since
that build and **zero** `GATE_TONE` lines, which v1.0.6 always writes. Inference: the phone's ring step is
still the pre-v1.0.6 code. The owner disputes this; the APK version on the phone is not yet confirmed.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Android: any-audio-file picker, copied to private storage, decode-probed | PR open | deventerprisesds/android-bridge-template#4, CI green run 38786739773 |
| 2 | Android: one play order (file → picked → bundled → system) + `ALARM_SOUND played=` trace | PR open | same PR; mutation FIRED run 38786992685 (`customFileIsTriedFirstWhenPresent`) |
| 3 | Journey Settings: "File" button + error toast (shows only on APKs with `openAlarmFilePicker`) | PR open | vite build OK; lint 27→27, tsc errors unchanged (2 pre-existing `testAlarmSound`) |
| 4 | Journey Voice APK rebuild + owner installs + real alarm logs `ALARM_SOUND played=custom-file` | **NOT confirmed live** | v1.0.7 built (run 38792129314); alarm log 17:00 shows phone still on 1.0.6 (GATE_TONE yes, ALARM_SOUND no) |
| 5 | REGRESSION reported 2026-10-15: alarm became a heads-up banner; full screen only on tap | merged (1b1d7b8) | deventerprisesds/android-bridge-template#5. Cause: v1.0.6 `setSilent(true)` on the gate notification → NotificationCompat GROUP_ALERT_SUMMARY → Android suppresses fullScreenIntent. Log: 16:30 (pre-1.0.6) full screen +0.3s; 16:45/17:00 (1.0.6) +43s/+36s on tap. Mutation FIRED run 38807499950 |
| 6 | Rebuild Journey Voice + Huddle APKs with #5; owner confirms full screen opens without a banner | built, **NOT confirmed live** | Journey v1.0.8 run 38809669594 (metadata hand-written 1ac01b0 after the build's own push failed); Huddle v1.0.8 336c509 |

## ACT:iris-window-trigger — each journey window call also triggers Iris's window message (2026-10-15)
Owner: *"i have tasks everyday and i do want a similar message for day in the morning and for each window as they pop up and to confirm prioritization ahead of scheduling the next day's build."*

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | notification-delivery POSTs Huddle run-schedule-brief with the window (iris-window.ts) | merged #57 (1d2dcf2), functions run 38807029267 | npm test 269/269; AC-IW2/AC-IW3 FIRED |
| 2 | Live test | PASSED (mechanism) | Test-Daily Wrap-up delivered 21:07:03 UTC; log `Iris window brief (after_work): HTTP 200 ... delivered:true`; Iris's reply recorded in huddle ACT:iris-day-and-window-briefs |

Huddle side + evening priority check: see huddle-extension-app ACT:iris-day-and-window-briefs. **NOT yet confirmed by the owner.**

## ACT:alarm-side-buttons-sound-settings (2026-10-17)
Side buttons silence the alarm; gear on the alarm screen opens the sound pickers. Android side:
deventerprisesds/android-bridge-template#6, Journey Voice v1.0.9 / Huddle v1.0.9 built. **NOT confirmed live.**
Full ledger: android-bridge-template `.claude/actions.md`.

## ACT:scheduling-config-restore (2026-10-19) — owner's September scheduling settings RESTORED
**Asked:** owner: *"critical restore … make sure the app is showing the accurate settings I used in September"*,
then the final decisions (windows as proposed; Sep 9–13 categories except Prof. education → evenings, Ventures →
weekends, Education = Prof. education, Personal = Life; remove keywords bill/business/project/startup; exercise
morning or after work).
**Backup (row before the write):** `user_scheduling_prefs` owner `a3378f93…`, updated_at
2026-09-13 16:12:41.80443Z, config = `{customAIInstructions}` ONLY (the 565-char default-style text, kept as is).
**Written 2026-10-19 16:27:07Z** (`config || {…}`, guarded on the old updated_at):
| item | value |
|---|---|
| timeWindows | morning 6–9 Mon–Fri · business_hours 9–17 Mon–Fri · after_work 17–19 Mon–Fri · evening 19–22 daily · flexible 9–22 daily · weekends 10–20 Sat/Sun |
| CAREER | business_hours, weekends · 120m |
| PROF_EDUCATION = EDUCATION | evening, weekends · 90m · maxPerDay 2 |
| VENTURES | weekends · 120m |
| LIFE = PERSONAL (status LIFE) | after_work, weekends · 60m |
| keywords | 46 = code defaults minus bill/business/project/startup; study + assignment → evening/PROF_EDUCATION; exercise stays morning/LIFE and relaxes to LIFE's windows via `withKeywordWindow` (#59) |
| workingHours / workloadBalance / priorityMappings | code defaults · caveats [] |
**Readback (same session):** all of the above confirmed by SELECT; removed keywords absent; AI text length 565.
**Code (this PR):** `src/utils/resolveKeywords.ts` — the app no longer spreads the 50 default keywords under the
stored list, so a removed keyword stays removed on screen and on the next Save (nightly builder already read the
stored list as-is). Tests R1–R5; R1 mutation FIRED. Zero impact on other users (only the system/test user stores
keywords, full list).
**Status:** written + read back. **NOT yet confirmed by the owner in the app / in a nightly run.**

## ACT:rename-taskos — the app is called TaskOS everywhere the owner sees it (2026-10-19)
Owner: "TaskOS. I don't need a new url or repo" / "staged B is fine, I don't need the url renamed or anything
else that is strictly backend". Labels only; URL, repos, Supabase, secrets and the Android package stay.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Web client says TaskOS | already done before this ACT | `src/` has no user-visible "Journey" on main 990b60d |
| 2 | Email footer "Sent by Journey" → "Sent by TaskOS" | **deployed** | deventerprisesds/journey-voice#60 (990b60d); deploy run 39287074527 success; live `notification-delivery` v591 source contains "Sent by TaskOS" |
| 3 | Android app name + widget → TaskOS | built | android-bridge-template f5e549a → TaskOS v1.0.11 (run 39288362792) |
| 4 | Owner sees TaskOS on emails / launcher / widget | **NOT confirmed live** | — |

## ACT:empty-evening-2026-10-19 — "why was the evening and after work blocks empty" (diagnosis; fix AWAITING OWNER ALIGNMENT)
Owner: *"why was the evening and after work blocks empty for the schedule that was built for today?"*, then
*"you are moving too fast without getting alignment ... i dont trust that you have looked upstream and downstream"*.
| # | Finding | Evidence |
|---|---|---|
| 1 | Today's schedule was built at 1:00 AM ET on the WIPED settings (restore landed 12:27 PM ET, after the build) — defaults: after_work 17–22, Ventures → after_work | `activity_log` nightly_schedule_built 05:01Z; `user_scheduling_prefs.updated_at` 16:27Z |
| 2 | Builder filled after_work 5–10 PM on paper (DBA, Aha!, Slack AI, CTO Playbooks 2h = 300/300 min) | `activity_log` step PLACEMENT_2026-10-19 |
| 3 | Exact-time step placed CTO Playbooks 8–10 PM; the post-check (`batch-calendar-scheduler` POST-VALIDATION 3, gpt-4o-mini, added by Lovable 2026-04-04 `6bf8ffc` "15-minute grid and guardrails") REMOVED it: "may be too late for focused work" | function log 2026-10-19T05:00:22Z |
| 4 | Retry put it 8–10 AM (morning, not a Ventures window) → rejected → rolled to Tue 6:15–8:15 PM | logs 05:00:30Z; `tasks` row 9f56f32a |
| 5 | Same 1 AM run: 9 post-check removals across the week, 8 of 9 "too late"-style for 8–9:30 PM slots, 1 haircut-at-lunch; 0 of the kinds it was built for (wrong day / venue closed) | function logs 05:00–05:01Z |
| 6 | From tonight (restored settings) weekday 5–7 PM = Life only, 7–10 PM = Education/Prof-Ed only (3 open, max 2/day), Ventures weekends only → weekday evenings will be sparse for a DIFFERENT reason | `user_scheduling_prefs.config` |
| 7 | Draft fix (narrow what the post-check may remove) written on `claude_schedule-sanity-timing`, NOT committed/deployed — owner asked for alignment first | local working tree |
| 8 | Owner ruling 2026-10-20: the post-check removing late business-type work and a lunchtime haircut is CORRECT. Draft "narrow it" fix DISCARDED (never committed) | owner message |
| 9 | There is NO 8 AM build. Only cron = `nightly-schedule-builder` `0 5 * * *` UTC (1 AM ET). The 8:00 "updated" stamps on Mon were Terry's Monday groom (assign/tag/rank); task times matched the 1 AM log slot-for-slot | `cron.job`; `activity_log` groom-summary push 12:00:25Z; function log 05:00:20Z |
| 10 | Course items reach journey only from Google Sheets (EMBA, MIT, schedule) via a MANUAL "Sync" button (AssignmentSyncSettings). Last sync 2026-04-06; newest due date in `assignments` 2026-06-23; 0 items due today or later → nothing for nightly-assignment-sync to turn into evening tasks | `sync_logs`; `assignments` max(due_date) |
| 11 | When items do arrive, they become PROF_EDUCATION tasks (now evening+weekends) capped at MAX_ASSIGNMENTS_PER_DAY=2 — the spreading mechanism exists; the data feed is what is stale | `nightly-assignment-sync`; `_shared/scheduling-defaults.ts:18` |

## ACT:dba-evenings — DBA readings/assignments from Nexus, spread ahead of time (owner 2026-10-20) — PLAN AWAITING GO
Owner: *"All readings and assignments are in nexus. focus on dba program. 2 a day limit is only for weekdays not weekends. there should be some logic to try to complete things ahead of time not alerted with little time to work with."*
| # | Finding | Evidence |
|---|---|---|
| 1 | Canvas → Nexus only via the Nexus Chrome extension when a course is opened (0.7.1 refresh-on-open not yet owner-confirmed) | nexus-hub `.claude/actions.md` ACT:course-refresh-on-load |
| 2 | Nexus → journey: NO link exists. journey's `nightly-assignment-sync` reads only journey's own `assignments` table (stale since 2026-04-06) | `nightly-assignment-sync/index.ts`; `sync_logs` |
| 3 | DBA in Nexus = MGT-701/702/782: 10 assignments, all due ≤ 2026-10-12 or undated; readings = 16 Pages + 51 Files in undated modules, 1 linked to a session; upcoming sessions 10-26, 10-27, 11-09, 11-10 | nexus db-query runs 39477107857, 39477686066 |
| 4 | Ahead-of-time today: assignment Tier A ≤48h (deadline-critical), Tier B 3–7d, Tier C >7d competes like any task → work is pushed only in the last week, hard only in the last 48h | `nightly-schedule-builder/index.ts:648-690,1076-1100` |
| 5 | 2-a-day cap applies every day: `MAX_ASSIGNMENTS_PER_DAY=2` (Tier B/C) + PROF_EDUCATION `maxPerDay: 2` | `_shared/scheduling-defaults.ts:18,40`; owner config |
| 6 | **REGRESSION (measured):** the owner-approved Aug–Sep work lives ONLY on unmerged `origin/claude/huddle-journey-integration-xokgv1` (64 commits, ~7.7k lines in supabase/ + src/: `_shared/nexus.ts` Nexus reader, `assignment-cadence.ts`, weekend-aware cap 2 weekday / 4 weekend, nudges, task-dedup, meeting confirmation, overflow queue, 9am tz-aware due-tomorrow migration). LIVE `nightly-assignment-sync` v246 (deployed 2026-10-18) is main's version: reads stale journey `assignments`, zero Nexus calls | `git diff --stat origin/main...<branch>`; `get_edge_function nightly-assignment-sync` |
| 7 | Nexus data: ingest DOES run on the extension's daily refresh (MGT-702 banked + Checkpoint 2 inserted 2026-10-20 18:48, due 2026-11-08); `capture_receipts.ingested_at` is not a freshness signal; DBA readings live in "Week Beginning <date>" page bodies; module_items frozen since 09-11; MGT-701 last captured 09-21, MGT-782 09-05 | `nexus-hub/docs/qc-evidence/RESEARCH-canvas-items-for-scheduling.md` |
| 8 | No lead-time number was ever recorded; current = Apr-17 tiers (≤48h guaranteed, 2–7d sorted first, >7d no priority). Open owner questions from Aug–Sep: should >7d work get deadline priority; per-day cap | `docs/qc-evidence/RESEARCH-assignment-lead-time.md` |

## ACT:parked-work-recovery (owner 2026-10-20)
Owner: *"I'm fine with your recommendations for 1-3, but i want a list of what is left parked once done so i can say which to apply next. The j1-j15 updates should be surgical so that if there is anything that was added in the oct 15 overwrite that will be lost, i know what the difference will be before and after"*; *"I would never ask for an overwrite that would undo so much hard work. going forward any overwrite that will undo or degrade vs extend or add or enhance has to list what will no longer be in place... 'always' as a hard hook rule"*; *"wherever you pull the module dates needs to be consistent for what you would expect standard across courses"*.
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Ship N1d (nexus outline draft gate) + N2 (nexus course-chat retrieval key) | both **merged** 2026-10-26 (N1d 302ef28, N2 d6ecd4e); N2 API deploy **succeeded** (run 40373176069); N1d web deploy **succeeded** (run 40373135913); NOT confirmed live by owner. N2 premise re-measured today: 880/880 chunks `topic_id`, 0 `course_id` | https://github.com/deventerpriseds-org/nexus-hub/pull/152 , https://github.com/deventerpriseds-org/nexus-hub/pull/154 |
| 2 | Ship E2 (push gate terminated rules slice) + E3 (feasibility screenshots rule) | E2 **merged** f507a58 (eds-claude-skills#123); E3 **merged** 1ceb638 (eds-claude-skills#124, guards green) | https://github.com/deventerpriseds-org/eds-claude-skills/pull/123 |
| 3 | Rebuild N1a/b on top of nexus dfc492cc (10-15) | built: PR open https://github.com/deventerpriseds-org/nexus-hub/pull/155 (19a3ff3, ext 0.7.4); tests green, 23/23 mutations FIRED; independent verifier running before merge (Tier 1: coverage count) | " |
| 4 | J1–J15: before/after loss report per feature BEFORE applying | J1–J5 written (75737e0); J6–J15 + summary lane running | docs/qc-evidence/RESTORE-J1-J15-diff.md |
| 5 | Hard hook: an overwrite that removes/degrades must list what will no longer be in place | AC done: 84 ACs, eds-claude-skills 7275e52 (`AC-overwrite-loss-gate.md`); build lane running on `claude_overwrite-loss-gate` with the 3 recommended (reversible) defaults; Tier 1, so independent verifier before merge | eds-claude-skills |
| 6 | Module/reading dates from ONE standard source rule across all courses | history research COMPLETE (0915a8c): no prior lead-time rule exists; DBA Pre-Work→Session N pairing is the natural reading deadline; open questions listed | docs/qc-evidence/RESEARCH-assignment-scheduling-history.md |
| 7 | List of what remains parked after 1–3 | pending | — |
