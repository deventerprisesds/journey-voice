// WHAT:       Whether the nightly builder should take a DONE task off the schedule: only when its slot has
//             not started yet (it frees future time). Pure; read by nightly-schedule-builder STEP 1.25.
// WHY:        Owner 2026-11-12: a task marked Done at 07:45 vanished from today's schedule when a rebuild ran
//             at 08:34 -- "it shouldn't be removed from the schedule because it was done. That has never been
//             the case." STEP 1.25 cleared EVERY scheduled DONE task; nightly runs at midnight hid that.
// SUPERSEDES: the unconditional DONE clear in STEP 1.25.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/done-slot.test.ts; function_logs 2026-11-12 13:34:29 "Cleared scheduling from 1 completed tasks".

/** True only for a slot that starts after `now`. Unparseable or missing start times are kept (never removed). */
export function freesSlot(startTime: string | null | undefined, now: Date): boolean {
  if (!startTime) return false;
  const t = Date.parse(startTime);
  return Number.isFinite(t) && t > now.getTime();
}
