# VERIFY calendar-ignore-categories, loop 2
Code under test: origin/main aff9cf7f (PR #140). Verifier worktree branch claude_verify-category-ignore-2. Started 2026-11-24 13:56 UTC.
Every mutation below was run with `mutate.sh`, with anchors read from files. Every FIRED is controlled (control EQUIVALENT), and every file was restored to HEAD (git status clean afterwards).

| # | claim | result | evidence |
|---|---|---|---|
| 0 | Suite on aff9cf7f | PASS | `node scripts/run-tests.mjs`: tests 765, pass 765, fail 0, exit 0 |
| a1 | Flipping `!keptIds.has` in `droppedExternalIds` is now caught | PASS | M1 `!!id && keptIds.has(id)`: FIRED on CC-11 (loop 1 found this INERT) |
| a2 | calendar-delta-sync really uses `droppedExternalIds(rows, kept)` and has no leftover inline filter | PASS | index.ts:1 imports it; :211 `purgeIgnoredCategoryRows(supabaseClient, connection, rules, droppedExternalIds(rows, kept))`; the only other `.filter(... external_event_id ...)` hits (:419, :634) are the older deleted-event reconciler. M2 swaps the arguments to `(kept, rows)`: FIRED on CC-9 (a source match) |
| a3 | null / undefined / '' / duplicate ids | PASS | probe: `[null, undefined, '', missing]` dropped gives `[]`; duplicate `A,A` gives `["A","A"]`, which is harmless in `.in()`; kept with an undefined id does not shadow a real one. M3 removes `!!id &&`: FIRED on CC-11 |
| a4 | End to end: decision plus dropped ids | PASS | config `['  PURPLE Category ']`: `Purple category` and `['Blue category','purple category ']` are dropped (p1, p2); `Purple` (substring), the bare string `'Purple category'` (not an array) and `null` are kept. A null-id Purple row is dropped but not purged by id, which is correct |
| b1 | onBlur handler adds the typed name | PASS (logic) | SchedulingSettings.tsx:594-598: empty or whitespace returns early; otherwise `addCategories(config.calendarIgnoreCategories, value)` and the box is cleared |
| b2 | Blur after Enter does not double-add | PASS | Enter clears `el.value` to `''`, so blur returns early. The probe confirms Enter('Client X') then blur gives `['Purple category','Client X']`; blur('client x ') is deduped case-insensitively |
| b3 | Empty or whitespace blur is a no-op | PASS | `'   '` returns before setConfig. `' , ,'` calls setConfig with the list unchanged |
| b4 | The onBlur fix has a guard | FINDING (minor, not a code defect) | M9 replaces the onBlur body with `return;` (blur adds nothing): INERT across the full suite. No test references the onBlur. Same class as loop 1's finding 1: the fix exists but nothing guards it |
| b5 | Blur in a real browser (clicking Save straight after typing) | UI, NOT RUN HERE | belongs to the separate browser UAT |
| S | Decision fn AC-1..10, S-1..S-18 | PASS | M5 turns exact match into a substring match in `hasIgnoredCategory`: FIRED on CC-3 (the spelling table) |
| F | Feed AC-13..18, AC-39 | PASS | M6 changes `categories: feedCategories(r)` to `[]`: FIRED on E1 |
| I | Integration manager AC-27/28 | PASS | M7 changes `categories: event.categories ?? []` to `[]`: FIRED on CC-10 |
| U | Frontend helpers AC-29..33 | PASS | M8 makes `setCategory` return undefined on the last untick: FIRED on CAT-2 |
| 7/38 | No assertion loosened | PASS | the squash diff removes one `assert` line (CI-4) and replaces it in the same hunk with the same regex plus `categories?: unknown` in the type |
| 11 | Migration | PASS (file) | `ALTER TABLE public.external_calendar_events ADD COLUMN IF NOT EXISTS categories text[];` |
| L | Live facts: column applied, owner config `["Purple category"]`, 129/129/0 feed sync | NOT-VERIFIABLE-HERE | no credentials in this run |

## Observation (low, outside the fix, not a defect)
`droppedExternalIds` returns nothing for an id that has one kept copy and one dropped copy in the same batch (`[{A},{A}]`, kept `[{A}]` gives `[]`). That only matters if one delta batch carries the same event twice with different categories. Not observed, and not grounded in the Graph docs here.

VERDICT: PASS (0 code defects; 1 minor finding: the onBlur fix is unguarded, M9 INERT)
