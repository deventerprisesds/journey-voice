# Project Memory — journey-voice (Scheduler focus)
Last updated: 2026-07-24 by session 017C29GJuPwR4Z4gJmiyCyGf

> Scheduler-scoped memo: how tasks get scheduled (priorities + external events +
> old/new, placed into sensible time windows) and the agreed direction to make it
> reliable. Companion: huddle-extension-app `.claude/memory.md` (Huddle = ranking only).

## THE ASK (2026-07-24)
Get **consistent** scheduler results — priorities, external calendar events, new AND
old tasks — **without old-but-important items dropping off**. Tasks land in a
**time-window system** with **common-sense checks** (not per-noun keywords) so items
go to sensible windows. Deliverables: (1) heavy assessment → memory + CLAUDE.md [this];
(2) gap review + scheduler sub-agent decision; (3) test plan judging schedules like an
executive/life assistant. Scope guard: **no meal windows** — make the working 80% → 100%.

### Refinements the user gave (authoritative)
- **Common sense, not keywords.** Church→Sunday etc. must fall out of general reasoning,
  not a keyword dictionary. Keywords may exist only as **test oracles**.
- **Venue-dependent errands** (bank, post office, gov office, pharmacy): default
  **after-work**, then a **nudge** to move to business/lunch hours when the venue is
  likely closed then. Must be caught **systematically** (trait), not per-word.
- **Doctor/dentist = Pinned trait.** When a real appointment time exists → **pinned/
  immovable**, any window ("already appointed outside your control"). When just an
  unbooked to-do → **flexible, NOT forced to business hours**. Hardcode doctor/dentist
  as **ground-truth anchors** to TEST that the systematic layer catches siblings
  (optometrist, physio, vet, specialist) the same way.
- **Value-aware overflow.** Current behavior: full window → task rolls to next available
  day for that window (KEEP for ordinary items). **Nudge only when a HIGH-IMPACT item
  overflows** (financial / time-sensitive / pinned appt / communication) so it can be
  **bumped up** (displace a lower-value item). Overflow nudge triggers on **any** full
  window, not just after 5pm. Scheduler ALREADY scores these high (reuse the signal).
- **External meetings need confirmation** ("are you doing this?"). On decline/no-show,
  release the slot and slot the **next task of that same category** into it.

## TRAIT MODEL (agreed design)
Classify each task by 3 orthogonal traits (inferred by the common-sense layer); rules
act on traits, not nouns → generalizes to unseen tasks:
| Trait | Detects | Behavior |
|---|---|---|
| Venue-dependent | needs a place/service w/ operating hours | default after-work; nudge to business-hours/next-open-day when likely closed |
| Pinned/fixed-time | externally-set slot (booked doctor/dentist/meeting) | placed at exact time, immovable, any window; unbooked → flexible, not forced to business hours |
| Impact-if-missed | financial / time-sensitive / others-waiting | value-aware overflow nudge (bump vs quiet roll); already scored high |

## Responsibility split (verified)
- **journey-voice = PLACEMENT.** Owns `tasks` (canonical), window defs, category/keyword
  →window mapping, nightly builder + batch scheduler (assign `start_time`),
  `find_open_slots`, external-calendar awareness, scoring/archive.
- **huddle = RANKING ONLY.** Mirrors tasks → Azure PG, additive score, `prioritize`
  returns ranked list. No time-window placement in Huddle. The "after_work 17–22 vs
  17–19" note in Huddle's CLAUDE.md is a drift *between two journey files*.

## Placement pipeline (journey)
- **Nightly builder** `supabase/functions/nightly-schedule-builder/index.ts` (~1770 ln),
  cron `0 3 * * *` **UTC** (global, not per-user tz). rollover→clear→archive→tier→
  score→dispatch. Scoring `:988-1072`, sort `:1079-1112`, archive `:542-631`,
  keyword override `getKeywordWindowOverride` `:219-243` (invoked `:1175`). ONLY path that reads keywords.
- **Batch scheduler** `supabase/functions/batch-calendar-scheduler/index.ts` (~767 ln).
  Assigns `start_time`: Gemini prompt + 3 validation passes + gpt-4o-mini "common-sense"
  pass `:666-743`. **Common-sense day/time matching lives in the prompt RULE 1c `:335-343`**
  (church→Sunday, errands→weekday business hrs, gym→morning, etc.) + RULE 1b hints `:363-372`.
  gpt-4o-mini pass **silently no-ops if OPENAI_API_KEY unset** → guard can vanish.
- **Smart scheduler** `supabase/functions/smart-calendar-scheduler/index.ts` (~1051 ln).
  Single-task manual/voice path. **Divergent engine**: own inline DEFAULT_CONFIG `:242-329`,
  only 4 categories (LIFE|CAREER|VENTURES|EDUCATION — no PERSONAL/PROF_EDUCATION), **NO
  RULE 1c common-sense**. Imports `validateTaskWindow` only. Root of path-dependent results.
- **execute-tool** `.../execute-tool/index.ts` (~2603 ln): `findOpenSlots` `:2436`,
  reschedule/move/swap/explainScore; server scoring mirror `:2295-2359`.

## Time windows — canonical (`_shared/scheduling-defaults.ts:29-45`)
```
morning 6–9 [1-5] | business_hours 9–17 [1-5] | after_work 17–22 [1-5] (weekdays)
evening 19–22 [0-6] | flexible 9–22 [0-6] | weekends 10–20 [0,6]
CAREER→[business_hours] PROF_EDUCATION→[after_work,weekends] max2/day
EDUCATION→[flexible] VENTURES→[after_work,weekends] LIFE/PERSONAL→[flexible]
```

## Live settings (DB: user_scheduling_prefs, tz America/New_York)
- Config is edited from a **GUI**, persisted to `public.user_scheduling_prefs.config` (JSON) + timezone.
- Saved `contextRules.keywords` ALREADY map bank/doctor/dentist/post_office→business_hours,
  errands/grocery/shopping→after_work, meeting→business_hours, appointment→flexible — but
  **only nightly reads keywords; the voice/manual path ignores them.**
- Config also has `customAIInstructions` (free-text), `workingHours`(maxDailyHours 7,
  breakMinutes 60), `workloadBalance`, per-category `estimatedDuration`, `PROF_EDUCATION.maxPerDay 2`.
- **Two rows:** seed user `…0001` has the rich config; real user `cce61d43…` has config `{}`
  (empty → runs entirely on hardcoded defaults). CONFIRM which is the live account.

## CONFIRMED BUGS / GAPS (evidence-based)
1. **Window config duplicated 5× and DRIFTED** — canonical `scheduling-defaults.ts` not
   imported by all. after_work 17–**22** (placer/validator) vs **17–19** (timeWindows.ts,
   build-day-context, execute-tool:2309/2317, dailyReviewPipeline, call-context-builder:805).
   evening/weekends also drift in execute-tool `:2318-2319`. → placed-window ≠ shown/searched-window.
2. **smart-calendar-scheduler is a divergent engine** (own config, no common-sense, 4 cats)
   → **path-dependent results**: same task scheduled differently by nightly vs voice/manual.
3. **array-vs-string LIVE bug** — GUI writes `categoryMappings.X.defaultTimeWindow` as an
   ARRAY (e.g. LIFE=["after_work","weekends","evening"]); smart-scheduler expects a STRING
   (`:216-220`) and silently drops it → user's saved category windows ignored on voice path.
4. **Keywords only read by nightly** → voice/manual bank task won't go to business hours.
5. **Overdue drift (seen in live data):** overdue non-assignment VENTURES tasks scheduled
   ~a week PAST their due date (due 2026-07-22, placed 2026-07-29/30). RULE 4 violated.
   Non-priority MED/LOW old-but-important tasks still take −3/−10 staleness + archive at 5+ pushes.
6. **windowCapacity computed then IGNORED** by batch (`batch:43`) → over/under-packing.
   `workingHours.maxDailyHours` likely not enforced.
7. **find_open_slots UTC-naive day bounds** `execute-tool:2442-2443` → misses 8pm–midnight local, DST-fragile.
8. **customAIInstructions** (GUI free-text) appears NOT injected into batch prompt (hardcoded). Likely dead.
9. **No venue-hours concept. No overflow QUEUE table/status. No pinned/fixed-time flag.** (to be added)
10. Nightly cron 3 AM **UTC** for all users (far-east users get mid-evening rebuilds).

## CORRECTIONS to earlier shallow findings (do not repeat)
- **Reminders ARE created on auto-schedule** — via DB trigger `schedule_task_reminders_trigger`
  (`…20251015004913…sql`) `AFTER INSERT OR UPDATE OF … start_time …` on tasks: creates
  `task_start_reminder` (default 15m before), `task_start_now`, due-date reminders; delivered by
  `notification-delivery` cron (every min). `generate-task-reminders` edge fn is LEGACY/superseded.
- Priority IS already elevated for financial/comms/time-sensitive: batch RULE 2 A/B/C `:374-389`;
  huddle scoring `hasSchedulingPriorityKeyword`+5, `isDueSoon`+5, `is_priority`+10.

## THE PLAN (scoped: 80%→100%, no meal windows)
A. **One source of truth** — collapse 5 window/category copies onto scheduling-defaults;
   reconcile after_work/evening/weekends drift; **de-fork smart-calendar-scheduler**;
   **fix array-vs-string** so saved category windows are read; wire dead GUI settings.
B. **Trait/common-sense layer in EVERY path** — reliable (not gated on OPENAI_API_KEY),
   present on nightly AND voice/manual; implement the 3 traits + venue-hours (LLM knowledge + nudge).
C. **Value-aware overflow** — quiet roll for ordinary; **nudge on high-impact overflow** to
   bump; **overflow queue** the agent watches; **external-meeting confirmation** releases slot
   to next same-category task.
D. **Overdue front-loading** — stop scheduling overdue tasks past due date.
E. **Pinned/fixed-time flag** — add the missing immovable-time concept (doctor/dentist booked).
F. **Test plan** — golden-path vs real pipeline: doctor/dentist anchors + sibling generalization;
   venue nudge; pinned immovability; high-impact overflow bump; external-meeting release;
   overdue front-loading; drift regression (placed-window == reported-window).

## Files to change (when we act)
- Windows/category (edit together): `_shared/scheduling-defaults.ts` (canonical) →
  `src/config/schedulingRules.ts`, `src/lib/timeWindows.ts`, `_shared/build-day-context.ts`,
  `src/utils/buildDayContext.ts`, `execute-tool:2305-2322`, `_shared/call-context-builder.ts:803-806`.
- De-fork: `smart-calendar-scheduler:242-329` → import `resolveConfig`/defaults + add common-sense.
- Placement: `batch-calendar-scheduler` prompt `:318-421`, validation `:585-644`, sanity `:666-743`; wire `windowCapacity`.
- Scoring/freshness/archive: `nightly:988-1072,542-631` + mirrors `schedulingCandidates.ts`, `execute-tool:2295-2359`.
- Reminders already handled by DB trigger `schedule_task_reminders` — don't rebuild.
- find_open_slots tz: `execute-tool:2442-2443` → `localDateToUtcBounds`.

## Sub-agent decision
No dedicated scheduler agent today — placement is raw Gemini/gpt-4o-mini calls in edge fns.
Direction: deterministic window/trait layer (source of truth + validation/repair) with an
LLM proposing and the deterministic layer validating — LLM not the only guardrail.

## Open inputs
- Settings wired-vs-dead sweep (agent) still to finalize the exact dead-settings list (§A, gap 8).
- Confirm which user_scheduling_prefs row is the live account.

## Active work
Assessment COMPLETE + corrected; trait model + plan AGREED. No scheduler code changed yet.
Next: finalize settings sweep → write acceptance criteria (define-acceptance-criteria) → implement.
Also queued (separate, pre-existing): android-bridge-template ScheduleWidget sort bug + inline-reply RemoteInput wiring.
