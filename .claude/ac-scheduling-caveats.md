# ACs — temporary scheduling caveats (journey)

Owner decisions settled 2026-08-26:
- Caveats **re-place already-scheduled tasks** (nightly rebuild moves them), not new-only.
- **Overflow = relax**: research that will not fit the caveat's window falls back to the
  regular placement rules *as if the caveat never existed*.
- `after_work` excludes Saturday. **Already shipped** — commit `e389201`, PR #27.

## Feasibility table — checked before writing ACs, not assumed

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| Named time windows (`evening` = 19–22 all days) | `_shared/scheduling-defaults.ts` `DEFAULT_TIME_WINDOWS` | all 4 schedulers via `resolveConfig` | read the file | **EXISTS** |
| Per-user window overrides | Settings → Scheduling → Time Windows | `resolveConfig` | `SchedulingSettings.tsx:253` | **EXISTS** |
| Keyword → window rules | Settings → "Keyword Detection Rules" | `nightly-schedule-builder` ONLY | `SchedulingSettings.tsx:575`; full `contextRules` sweep | **EXISTS-BUT-CONSTRAINED** — nightly path only |
| Ordered preference with capacity fall-through | `getPreferredWindows` | `nightly-schedule-builder:1203` loop | read the loop | **EXISTS** — this IS the relax rule |
| Per-window per-day capacity budget | `windowRemaining` | same loop | read the loop | **EXISTS** |
| Expiring / temporary rules | — | — | `grep expires_at` over migrations: nothing on `user_scheduling_prefs` | **ABSENT** — the only genuinely new part |
| Config store | `public.user_scheduling_prefs` (JSONB `config`) | `loadUserSchedulingConfig` + 4 edge fns | live query | **EXISTS** |

**ALREADY BUILT, stated first:** a permanent `research → evening` rule is addable through the
Settings UI today with no code. The ONLY missing piece is the temporary/expiring half, plus
making a caveat a *soft* preference rather than the hard override a keyword rule produces.

## The one core system

`supabase/functions/_shared/scheduling-defaults.ts::resolveConfig` — four consumers
(`nightly-schedule-builder`, `batch-calendar-scheduler`, `execute-tool` ×2,
`smart-calendar-scheduler`). **EXTEND it.** Do not add a parallel resolver.

## The critical implementation trap (evidenced, not inferred)

A keyword override REPLACES the preference list:

```js
preferredWindows = [keywordOverride.window];   // nightly-schedule-builder:1190
```

so it is a HARD constraint — if `evening` is full the task falls out of the loop unplaced.
That is the OPPOSITE of the relax rule. A caveat must PREPEND instead:

```js
preferredWindows = [...caveatWindows, ...baseWindows.filter(w => !caveatWindows.includes(w))];
```

The existing `for (const winName of preferredWindows)` fall-through then delivers relax for
free — no overflow code to write.

---

## Acceptance criteria

**AC-1 — a caveat is preferred, never forced.**
Given an active caveat `research → evening` and a research task whose duration fits the
remaining `evening` capacity for the target day, when the nightly build runs, then the task is
placed inside 19:00–22:00 local.

**AC-2 — overflow relaxes to the normal rules (the owner's rule).**
Given the same caveat and more research minutes than the day's `evening` capacity, when the
nightly build runs, then the tasks that fit go to `evening` and each task that does not fit is
placed by the UNMODIFIED rules — the same window it would have received with no caveat present.
It is never left unplaced *because of* the caveat.
*Regression guard:* a caveat must never reduce the number of tasks placed. Assert
`placedCount(withCaveat) >= placedCount(withoutCaveat)` over the same fixture.

**AC-3 — already-scheduled tasks are re-placed.**
Given research tasks already carrying `start_time` outside `evening`, when a caveat is added and
the nightly build runs, then those tasks move into `evening` subject to AC-2.

**AC-4 — expiry needs no cron.**
Given a caveat with `expiresAt` in the past, when `resolveConfig` runs, then it is absent from
the returned active set and placement is byte-identical to no-caveat. Given `expiresAt: null`,
it stays active until explicitly cleared.

**AC-5 — clearing restores prior behaviour with zero migration.**
Given a caveat that has been applied and is then cleared, when the next build runs, then
placement matches the no-caveat baseline exactly — because the caveat was never written into
`config`, only overlaid at read time.

**AC-6 — precedence is caveat > keyword > category.**
Given a task matching BOTH a keyword rule and a caveat, when windows resolve, then the caveat's
windows lead the ordered list, the keyword's window follows, then the category defaults. No
entry is dropped — that ordering is what makes AC-2 hold.

**AC-7 — aggregate-fit eligibility is judged on the BASE list.**
The flexible-capacity fallback at `nightly-schedule-builder:1215` is gated on
`preferredWindows.length === activeWindowNames.length`. Prepending a caveat window changes that
length. Given a task that qualified for aggregate-fit with no caveat, when a caveat applies,
then it STILL qualifies — eligibility is computed from the base list, not the caveat-modified
one. *This is a real regression the naive edit introduces.*

**AC-8 — a caveat window must be active that day.**
Given a caveat naming a window not in `activeWindowNames` for the target day, when placement
runs, then the caveat contributes nothing for that day and the base rules apply unchanged
(mirrors the existing `getKeywordWindowOverride` guard).

**AC-9 — the day's window bounds are still absolute.**
No caveat may place a task outside its named window's `start`/`end`, or on a day excluded by
that window's `days`.

**AC-10 — integration boundary.**
Given Huddle integrated, when an agent sets a caveat, then it is written through the journey
proxy and journey remains the only scheduler — Huddle stores no second copy. Given Huddle
standalone, the same caveat record overlays Huddle's own layer.

## Explicitly OUT of scope

- Closing the "keyword rules are nightly-only" gap (`execute-tool` / `batch-` / `smart-`).
  Tracked separately; landing caveats in the shared module makes it cheap later.
- A parity test between the two defaults files. Tracked separately.
- Changing `after_work.end` (owner's stored `19` is deliberate).

## Verification note

`resolveConfig` prefers `userConfig.timeWindows` WHOLESALE, so any claim that a default changed
must be verified against the stored row in `user_scheduling_prefs`, never against the source
file. The owner's row already excluded Saturday before commit `e389201`.
