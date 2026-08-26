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

**[BLOCKED — needs owner] The one fork:** does a caveat RE-PLACE already-scheduled tasks (the nightly
rebuild moves research off 10am), or apply only to newly-scheduled ones? Not answerable from the code.
The first reading is materially more work (a re-placement pass) than the overlay itself. ACs cannot be
written until this is settled.

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
