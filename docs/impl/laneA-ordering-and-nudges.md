# Lane A — ordering, venue-nudge persistence site, digest bound/format, duplicate digests

<!--
WHAT:       Implementation log for Lane A of the 2026-09-03 nudge + ordering work. Records,
            section by section, what changed in the three Lane-A files and why.
WHY:        The previous round shipped on self-gathered evidence and an independent verifier
            refuted it (docs/verify/nudge-delivery-loop1.md). This file is written AS THE WORK
            HAPPENS so a container reclaim costs one step, not the pass.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   docs/ac/nudge-and-ordering-ACs.md (42 ACs); docs/verify/nudge-delivery-loop1.md;
            live column query against project wwxgajrtmslzklnyplah quoted inline below.
-->

**Owned files (nothing else was touched):**

- `supabase/functions/_shared/nexus.ts`
- `supabase/functions/_shared/nudges.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`
- plus new committed tests beside the modules: `_shared/nexus.test.ts`, `_shared/nudges.test.ts`

**Scope owned:** AC-1.x (ordering), AC-4.x (duplicate digests), AC-7.x (nudge message at the
persistence site), AC-8.x (digest date bound + time format).

Status legend: DONE = implemented and covered by a committed test; PARTIAL = implemented, one
part deferred with a reason; NOT MINE = outside Lane A's file ownership.

---

## Ground truth gathered before editing (commands run this session)

| # | Observation | Source |
|---|---|---|
| L1 | Live `public.scheduled_notifications` columns are exactly `id, user_id, task_id, notification_type, title, body, scheduled_for, delivered_at, failed_at, failure_reason, created_at, processing_at, processing_instance, queued_during_quiet, original_scheduled_for, metadata`. There is **no `status`** and **no `send_at`**. | Supabase MCP `execute_sql` on `information_schema.columns`, project `wwxgajrtmslzklnyplah` |
| L2 | `courseworkOrder` / `courseworkBand` / `COURSEWORK_BAND_LABEL` have exactly two importers: `execute-tool/index.ts:8` (tool output + `band` label) and `nightly-schedule-builder/index.ts:25` (placement). Changing the bands changes BOTH. | `grep -rn` over `*.ts`/`*.tsx` |
| L3 | `_shared/nexus.ts` already guards Deno (`typeof Deno !== 'undefined' ? Deno.env.get(...)`), so it imports cleanly under `node --experimental-strip-types`. Verified: `nexus import OK, exports: 15`. `_shared/nudges.ts` has no `Deno` reference at all. | `node --experimental-strip-types -e "import(...)"` |
| L4 | The venue-nudge template at `nightly-schedule-builder/index.ts:1531` is written inside the window-plan block, BEFORE the placement loop at `:1556` — so no `start_time` exists yet. The real persistence sites are `:1743-1759` (main) and `:1883-1894` (retry pass), and BOTH have `slot.start_time` in scope. | file read |
| L5 | The overflow message is ALSO hardcoded outside `_shared/nudges.ts`, at `index.ts:1470` (`"…couldn't fit <date>…"`). AC-7b's rule ("no hardcoded nudge text outside `_shared/nudges.ts`") covers it, not just the venue one. | `grep -n "couldn't fit"` |
| L6 | `localDateToUtcBounds(localDate, tz)` is already imported by the builder (`:22`) and already used for timezone-safe day bounds at `:528` and `:1092`. AC-8a needs no new helper. | file read |

---

(sections below are appended as each piece lands)
