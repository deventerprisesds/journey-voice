# Actions — journey-voice

Persistent checklist of what the owner has asked for, what is open, and the evidence for
anything called done. One ACT entry per request. Pairs with `.claude/memory.md` (which holds
the technical findings) and `.claude/accuracy-log.md` (wrong-first-answers).

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
