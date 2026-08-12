# Actions log — journey-voice

## Scheduling: recency + "work-on-these-today" intake (2026-08-11)
Request: (1) recently-added due-today items must bubble into today's schedule (recency not burying them
under old priorities); (2) when the user signals "work on these today", schedule within appropriate
windows first and treat overflow as FLEXIBLE — displacing lower-priority ORIGINAL board items — instead
of pushing the signaled items to another day; stated priority must still have bearing. Fix the "Add a
task for today" button double-booking + un-blocked external events.

- [DONE] parse_and_create_tasks dryRun 1:1 harness (commit 8d70611) — reproduces the real button flow zero-write.
- [DONE] Conflict-aware apply, flag-gated `conflictAware:true` (commits 4ef7b8c + 0d9bb68), deployed live.
  Windows-first → flexible-today → displace strictly-lower-priority originals; external events inviolable;
  no double-booking; end_time always set; dryRun zero-write. Proven live via pg_net dryRun + overlap SQL
  (overlapping_tasks/events/placed all 0). Independent verifier spawned to confirm.
- [OPEN] Turn the flag ON in the UI (QuickTaskInput → pass conflictAware:true) once the user confirms the
  live before/after looks right — awaiting user sign-off (they wanted to SEE expected outputs first).
- [OPEN/follow-on] Parser assigns LOW to unqualified "add for today" items → they won't displace existing
  MED originals on plain phrasing. To make "signaled for today = displaces lower originals" work without
  explicit priority words, raise priority for button-signaled items (parser or QuickTaskInput).
- [OPEN] Composite scoring switch in nightly-schedule-builder (commit 925d9df) for the recency-bubbling
  half — validated earlier; awaiting user sign-off to make default.

## OPEN — to investigate next (2026-08-12)
- [CHECK] **PROF_EDUCATION maxPerDay:2 not enforced.** Composite 7-day dryRun (rid 567100) placed 4
  PROF_ED tasks on Mon 08-17 (09:00 Complete MIT, 10:00 Start AI cert, 11:00 Import MIT, 12:00 Find
  sample AI consultants) despite config `PROF_EDUCATION.maxPerDay=2`. Cap appears ignored in the
  builder/slotter. Confirm where maxPerDay should be enforced and why it isn't.
- [CORE GAP] **Overdue + just-added "needed yesterday" items don't surface onto TODAY.** User added ~15
  items yesterday (due 08-11, now overdue). Composite (which already demotes is_priority from +10→+2/3)
  still landed only 3 on today (Amex, Reserve vehicle, Research Agentforce) and scattered the rest to
  Thu–Mon. Root: scoring has no strong "overdue AND recently-flagged → do NOW/today" signal — recency is
  only +2, due-soon(±48h incl overdue) +5, both easily outweighed; and even when scored up, day-assignment
  spreads them instead of filling today first. Needs: (a) a real overdue/aging escalation term (grows with
  days overdue, not just a flat +5 within 48h; today only assignment_id tasks get the +10 grace), and/or
  (b) day-assignment that fills TODAY's remaining windows with overdue items before spreading to later days.
  Do NOT hardcode — extend the composite score + the builder's per-day placement. User is firm this is the
  real miss. (Separate from the 1h day-start delay, still traced via tonight's slotter_trace run.)
