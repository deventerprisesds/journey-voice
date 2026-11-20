# VERIFY-task-priority-enum-1

- WHAT: independent verification of the task_priority enum fix (normalizePriority / recognizePriority and its call sites).
- WHY: 2026-11-19 18:21/18:22 UTC Iris's task creation failed with 22P02 (ai-task-parser returned priority "BACKLOG").
- SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
- EVIDENCE: this file; commands below.

VERIFY LOOP: 1
Branch/commit verified: origin/claude/vibrant-allen-p52snq @ f6272424 (origin/main 13d68d8c + 1 commit)
Verdict: IN PROGRESS
Defects found: (filled at the end)
Cheap suite re-run covering EVERYTHING: (filled at the end)

## Claim verdicts (appended as they land)

### Claim 1 -- helper semantics: CONFIRMED
Read `supabase/functions/_shared/task-priority.ts`. Probe script (node --experimental-strip-types) over 38 inputs:
- Correct mapping: "  high  ", "HiGh", "\thigh\n" -> HIGH; "critical", "Critical " -> URGENT; "medium" -> MEDIUM.
- Non-strings (1, 0, {}, [], ["HIGH"], null, undefined, true, NaN, new String("HIGH")) -> normalize MEDIUM / recognize null. No throws.
- Prototype-key probes ("toString", "constructor", "__proto__", "CONSTRUCTOR") -> MEDIUM/null: the alias lookup is on the UPPER-cased string, and no Object.prototype key is all-upper-case, so `PRIORITY_ALIASES[up]` cannot return a function.
- Every output is in {LOW,MEDIUM,HIGH,URGENT} or null. The enum can never be violated by the helper.
- Lossy-but-safe (intent lost, MEDIUM/null returned): "Urgent!", "high priority", "high-priority", "P1", "p0", "immediate", "asap", "HIGH​" (zero-width), full-width "ＨＩＧＨ". None is a DB failure; they are a quality gap, not an enum defect.
