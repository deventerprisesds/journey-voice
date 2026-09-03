# Verification Report — journey-nudge-delivery-and-assignment-scoping (loop 1)

Repo `/home/user/journey-voice`, branch `claude/huddle-journey-integration-xokgv1`,
verified head `826d31064196ded00d9533f21cda63639125edd1` (confirmed via `git rev-parse HEAD`).
Working tree clean (`git status --porcelain` → empty).

Verifier has no shared context with the implementing agent. Every line below is an observation
with a command or a `file:line` citation, or it is explicitly labelled an inference.

---

## C1 — `buildVenueNudgeMessage` weekend/business-hours/no-"after work"

**Verdict: CONFIRMED for the function itself. The wider claim it "fixes a real bug" is
REFUTED as stated — the bug is still live on the path the user actually sees.**

### C1a. Function behaviour — CONFIRMED

Brute-forced all 7 weekdays × 24 local hours in `America/New_York` by importing the real
module (`bun run` against `/home/user/journey-voice/supabase/functions/_shared/nudges.ts`):

| Case | Observed |
|---|---|
| Weekday 09:00–16:59 (inside `businessHours` 9–17) | `null` for all 8 hours |
| Weekend 10:00–16:59 | `null` for all 7 hours, both Sat and Sun |
| The exact reported case: Sunday 2026-09-06 10:00 ET, "Go to church" | `null` |
| Messages across all 168 combinations containing `/after work/i` | **0** |

Raw output for the headline case:

```
SUNDAY 10:00 ET "Go to church" => null
2026-09-06 Sun askedH=10 -> NULL
2026-09-05 Sat askedH=10 -> NULL
2026-09-04 Fri askedH=09..16 -> NULL
=== messages containing "after work": 0
```

Code backing it: `supabase/functions/_shared/nudges.ts:93` (weekday business-hours → null),
`:97` (weekend 10–17 → null), and the only three return strings at `:98`, `:102`, `:104`
— none contains "after work".

### C1b. Caveat on "weekend-daytime" — the null window is 10:00–16:59, not all daytime

`nudges.ts:97` is `if (hour >= 10 && hour < 17) return null;`. A **weekend 09:00** placement
still raises a nudge:

```
2026-09-06 Sun askedH=9 -> "Go to church" is on the weekend at 9:00.
   Most places that need a counter are shut then — want it moved into the day?
```

Most 10:00 church services are fine; a 9:00 one is not, and 9am on a Saturday is
ordinary daytime. Observation, not a claim failure — but "weekend-daytime returns null"
is looser than what the code does.

### C1c. The bug is NOT fixed on the surface the user sees — REFUTED

This is the material finding. `buildVenueNudgeMessage` is only consulted by the **new digest
path**. The message that is **persisted** into `scheduling_context.venue_nudge` — and which
every pre-existing consumer renders — is still the old fixed template, unchanged by this
commit:

`supabase/functions/nightly-schedule-builder/index.ts:1529-1534`

```ts
if (plan.nudgeToBusinessHours) {
  venueNudgeByTaskId.set(task.id, {
    toWindow: 'business_hours',
    message: `"${task.title}" is scheduled after work, but this kind of errand usually
              needs a place that's open during business hours. Want to move it into a
              business-hours slot?`,
  });
}
```

Two independent problems with that site, both still present at head `826d310`:

1. It still says **"scheduled after work"** — the exact phrase the commit message claims is
   gone. `grep -rn "after work" supabase/functions/nightly-schedule-builder/index.ts` returns
   this line.
2. It is written at **window-plan resolution time (line 1529)**, *before* the placement loop
   that assigns a window (`for (const winName of preferredWindows)` at `:1555`) and long
   before a `start_time` exists. So it is structurally incapable of describing the real
   placement — it is placement-blind by construction, which is the root cause the commit
   claims to have fixed.

And the stored string is what all three pre-existing consumers render — they read
`venue_nudge.message` verbatim, they do not re-derive it:

- `supabase/functions/_shared/build-day-context.ts:256,262`
- `src/utils/buildDayContext.ts:255,261`
- `src/components/DailyReviewModal.tsx:275,280`

**Consequence:** after this commit, "Go to church" on Sunday 10:00 ET is correctly *omitted
from the new morning digest*, but the Daily Review modal and the day-context briefing will
**still** show the user "…is scheduled after work … Want to move it into a business-hours
slot?". The user-visible defect described in the commit message is still reproducible on
two of the three surfaces. The fix was added alongside the bug rather than at the bug.

This also means the two layers now **disagree**: the digest stays silent about a placement
while the review modal nags about the same task on the same day.

---

## C2 — "before this change every nudge consumer was a passive reader, no delivery path existed"

**Verdict: CONFIRMED (with two corrections to the supporting evidence).**

Checked the parent commit tree directly, not the working tree:

`git grep -n "venue_nudge" ce8f234 -- '*.ts' '*.tsx'` returns exactly 11 hits in 4 files.
All read sites are `.filter(...)` projections into a view object:
- `src/components/DailyReviewModal.tsx:275,280`
- `src/utils/buildDayContext.ts:255,260,261`
- `supabase/functions/_shared/build-day-context.ts:256,261,262`
- producer only: `supabase/functions/nightly-schedule-builder/index.ts:1739,1744` (writes the
  marker into `scheduling_context`)

`git grep -n "task_overflow_queue" ce8f234` returns: one UI read
(`DailyReviewModal.tsx:199`), the builder's own delete/upsert (`index.ts:1010`, `:2092`),
and the migration. No notifier.

The parent builder's only `scheduled_notifications` reference is at `index.ts:564` and it is a
**DELETE** (purging today's pending rows), not a write. So: no `insert` into
`scheduled_notifications`, no `send_push`, no `send-chat-message` invocation anywhere keyed on
either nudge kind in the parent. **The "computed but never delivered" claim holds.**

### Correction 1 — one of the three cited "consumers" is dead code

`supabase/functions/_shared/build-day-context.ts` has **no importer anywhere in the repo**:

```
$ grep -rn "build-day-context\|buildDayContext" --include=*.ts --include=*.tsx . | grep "import"
./src/components/DailyReviewModal.tsx:27:import { buildDayContext } from '@/utils/buildDayContext';
```

The only importer is of the `src/utils/` copy. The edge-function copy is an unreferenced
duplicate. Citing it as evidence of "every consumer" inflates the consumer count from 2 to 3.
Does not change the verdict; it does mean the codebase carries a duplicated, drifting
day-context builder that nothing calls.

### Correction 2 — a daily digest channel already existed (just not nudge-aware)

Live `scheduled_notifications` shows a `daily_digest` / "Daily Task Summary" delivered every
morning (e.g. `4939390b-…`, scheduled 2026-09-03 12:15Z, delivered 12:16Z). So the claim is
precisely "no nudge-keyed delivery", not "no daily outbound existed". The new digest is a
**second** morning message rather than an extension of the one already being sent — worth
noting against the repo's own "extend, don't duplicate" rule, though the channels differ
(`daily_digest` push vs `scheduled_chat` Iris message).

---

## C3 — nightly-schedule-builder queues a digest via `scheduled_notifications`

**Verdict: CONFIRMED for the mechanism, imports and symbols. Two real defects found in the
same block.**

### C3a. Code path — CONFIRMED

`supabase/functions/nightly-schedule-builder/index.ts:2112-2160`:
- `notification_type: 'scheduled_chat'` — `_shared/nudges.ts:186`
- held to a configurable local hour, default 8 — `index.ts:317`
  `const nudgeHourLocal: number = Number(config?.nudges?.deliverAtLocalHour ?? 8);`
  applied at `index.ts:2153` via `nextLocalHour(now, nudgeHourLocal, timezone)`
- skipped under dryRun — `index.ts:2119` `if (!dryRun) {` wraps the whole body
- non-fatal — `index.ts:2158-2159` `} catch (e) { console.warn('  ⚠️ nudge delivery error
  (non-fatal):', e); }`

Hold-to-morning proven numerically, not read: a build at `2026-09-04T05:00:00Z` (= 01:00 ET,
matching the real cron) produces `scheduled_for = 2026-09-04T12:00:00.000Z` = **08:00 ET the
same morning**. Correct.

Real cron confirmed live: `select schedule from cron.job where jobname='nightly-schedule-builder'`
→ `0 5 * * *` (01:00 ET). `notification-delivery-job` runs `* * * * *`.

### C3b. Every symbol is imported/declared — CONFIRMED (this was the specific risk)

`index.ts:26`:
```ts
import { venueNudge, overflowNudge, deliverNudgeDigest, nextLocalHour, type Nudge } from "../_shared/nudges.ts";
```
All five are exported from `_shared/nudges.ts` (`:107`, `:130`, `:176`, `:205`, `:40`).
Locals: `nudgeHourLocal` `:317`, `businessHoursForNudges` `:320`, `now` `:407`, `dryRun` `:263`,
`timezone` `:313`, `userId` `:312`.

**Scope hazard checked explicitly and cleared.** `index.ts:1718` declares
`const venueNudge = venueNudgeByTaskId.get(slot.taskId);` — a `const` that shadows the
*imported function of the same name*. If the delivery block were inside that binding's scope,
`venueNudge(...)` at `:2133` would throw `TypeError: venueNudge is not a function` at runtime
while bundling perfectly. It is not: `:1718` sits inside the `for (const slot of scheduled)`
loop opened at `:1710`, itself inside the per-day loop opened at `:1065`, which closes at
`:1995`. The delivery `try` at `:2118` is at the same indent level (8) as `const now` at `:407`,
both inside the per-user `try` at `:374` — outside the shadow. Verified by brace-depth
computation over the file, not by eye. **No shadowing bug, but this is one rename away from
one, and it is exactly the class of bug that bundles clean.**

Deployment confirmed independently of git: `mcp__Supabase__get_edge_function` for
`nightly-schedule-builder` returns `"status":"ACTIVE","version":217`,
`updated_at: 1788460759532` (= 2026-09-03T18:39Z, minutes after the `826d310` commit time
18:38:47Z). The deployed bundle contains `deliverNudgeDigest`, `nextLocalHour`,
`businessHoursForNudges`, `nudgeHourLocal` and `_shared/nudges.ts`. So this **is** live despite
being on a non-`main` branch.

Schema validated against the live table — `scheduled_notifications` has
`user_id, notification_type, title, body, scheduled_for, metadata` and **no** `status` column.
The insert at `nudges.ts:184-199` uses only valid columns. It will not fail on schema.

### C3c. DEFECT — the venue query has no date bound, despite being named `placedToday`

`index.ts:2126-2131`:
```ts
const { data: placedToday } = await supabase
  .from('tasks')
  .select('id, title, start_time, scheduling_context')
  .eq('user_id', userId)
  .eq('is_scheduled', true)
  .not('start_time', 'is', null);
```
No `gte`/`lt` on `start_time`. It returns **every scheduled task the user has**, not today's.
Live proof — the 5 real `venue_nudge` rows for `a3378f93-…` span five days:

| local start | title |
|---|---|
| Thu 2026-09-03 20:15 | Buy new cord for Ghost |
| Fri 2026-09-04 17:45 | Pick up daughter from college |
| Fri 2026-09-04 18:15 | Pick up wife's vehicle from the shop |
| Sat 2026-09-05 16:00 | Take son shoe shopping |
| Mon 2026-09-07 18:00 | Cancel or take wife's SUV for repair |

So the 08:00 Friday digest would nag about a **Monday** placement and about a **Thursday** one
already in the past. The variable name asserts a filter the query does not have.

### C3d. DEFECT — the message floors the time to the hour, misstating the placement

The commit's stated purpose is that "wording is now derived from the ACTUAL placement". It is
derived to the hour only. `nudges.ts:89` takes `localHourOf(...)` and `:104` interpolates
`${hour}:00`. Running the real functions over the real rows above:

```
Pick up daughter from college  (actual 17:45 ET) -> "... is scheduled at 17:00, after most places close."
Buy new cord for Ghost         (actual 20:15 ET) -> "... is scheduled at 20:00, ..."
Pick up wife's vehicle         (actual 18:15 ET) -> "... is scheduled at 18:00, ..."
```

A message whose entire justification is accuracy tells the user 17:00 for a 17:45 task. Also
rendered in 24-hour form to an `America/New_York` user, where every other surface in this repo
uses am/pm labels.

### C3e. The digest the deployed code will actually queue

Computed by running the real `venueNudge` / `overflowNudge` / `composeDigest` exports against
the 5 live venue rows and the 1 live open `task_overflow_queue` row:

```
title: 5 things worth a look
5 items on your schedule I'd flag:
• "Buy new cord for Ghost" is scheduled at 20:00, after most places close. Move it into business hours?
• "Pick up daughter from college" is scheduled at 17:00, after most places close. Move it into business hours?
• "Pick up wife's vehicle from the shop" is scheduled at 18:00, after most places close. Move it into business hours?
• "Cancel or take wife's SUV for repair" is scheduled at 18:00, after most places close. Move it into business hours?
• "Go to church" is high-impact (is_priority, overdue) but couldn't fit 2026-09-03 (no window capacity).
```
"Take son shoe shopping" (Sat 16:00) is correctly dropped — the weekend fix works on the
digest path.

No digest has ever been queued: `select ... from scheduled_notifications where
metadata->>'source'='nudges'` returns **zero rows** across the user's whole notification
history. The path is deployed but has not yet run (next cron 05:00Z).

---

## C4 — `list_pending_assignments` deployed, scoped to active courses, not led by 2025 backlog

**Verdict: CONFIRMED on "deployed" and "not led by old backlog". PARTIALLY REFUTED on
"scoped to active courses" — the scope admits a course whose newest deadline is 7 months old.**

Invoked live through `pg_net` (direct HTTPS to functions is blocked from this sandbox):

```sql
select net.http_post(
  url := '.../functions/v1/execute-tool',
  body := '{"toolName":"list_pending_assignments",
            "userId":"a3378f93-d655-4913-b2fa-ca5b1d8020f1","args":{}}'::jsonb, ...);
-- request_id 670450
select status_code, ... from net._http_response where id=670450;
--  status_code 200 | count 29 | total 29 | "29 pending assignments"
```

### Actual top 14 rows and their `band` values

| # | band | due | course | title |
|---|---|---|---|---|
| 1 | **recently overdue** | 2026-08-18 | Applied Generative AI | Required Assignment 6.1: AI Readiness Assessment & Change Plan |
| 2 | **recently overdue** | 2026-08-11 | Applied Generative AI | Required Assignment 5.1: Responsible AI Governance Brief |
| 3 | old backlog | 2026-08-04 | Applied Generative AI | Required Assignment 4.1: Teach What You Know |
| 4 | old backlog | 2026-07-28 | Applied Generative AI | Required Assignment 3.1: Your Prompt in Practice |
| 5 | old backlog | 2026-07-21 | Applied Generative AI | Required Assignment 2.1: Can You Trust This AI Output? |
| 6 | old backlog | 2026-07-14 | Applied Generative AI | Required Assignment 1.1: The AI Moment |
| 7 | old backlog | 2026-01-23 | AI and Business Strategy | Final "generative AI startup" presentation |
| 8 | old backlog | 2026-01-22 | AI and Business Strategy | Upload video for case- NVIDIA |
| 9 | old backlog | 2026-01-22 | AI and Business Strategy | Read: HBR Case: Summer Health |
| 10 | old backlog | 2026-01-22 | AI and Business Strategy | Read: HBR Case: NVIDIA |
| 11 | old backlog | 2026-01-22 | AI and Business Strategy | Upload video for case- Summer Health |
| 12 | old backlog | 2026-01-22 | AI and Business Strategy | Upload video for case- NVIDIA |
| 13 | old backlog | 2026-01-15 | AI and Business Strategy | Upload video for case- Moderna |
| 14 | old backlog | 2026-01-15 | AI and Business Strategy | Upload video for case- Stitch Fix |

Full band/course distribution of the 29 returned rows:

| course | band | n | due range |
|---|---|---|---|
| AI and Business Strategy | old backlog | **12** | 2026-01-08 → 2026-01-23 |
| Applied Generative AI | no due date | 10 | — |
| Applied Generative AI | old backlog | 4 | 2026-07-14 → 2026-08-04 |
| Applied Generative AI | recently overdue | **2** | 2026-08-11 → 2026-08-18 |
| AI and Business Strategy | no due date | 1 | — |

**Confirmed:** the list is led by the two *recently overdue* items from the live course, and
undated items sort last (band 5). It is emphatically not led by an ancient backlog. Ordering
matches `courseworkOrder` exactly: band 2 before band 4, and within band 4 most-recent-first
(2026-08-04 → 2026-01-08).

**Not confirmed:** there are **zero** band-1 ("due soon") and zero band-3 ("upcoming") rows, so
the "due-soon ahead of recently-overdue" half of the claim was **not exercised by live data** —
only its band-2-before-band-4 half was. That half is proven offline by the sweep, not live.
Call it UNVERIFIABLE-HERE for the live path.

**Scoping caveat (material).** `resolveActiveCourseIds` (`_shared/nexus.ts:200-227`) infers
activity from **ingestion recency** (`created_at`), not from course activity. "AI and Business
Strategy", whose newest assignment was due 2026-01-23 — over seven months ago — is admitted and
supplies **13 of the 29 rows (45%)**. So "scoped to the courses the user is actually taking"
(`execute-tool/index.ts:2670` comment) overstates it: importing a course recently is treated as
taking it, which the commit message does state explicitly ("importing a course is taking a
course") but the code comment and the claim do not. The user asking "what's pending?" still gets
a list that is 45% January coursework — better than before, not solved.

---

## C5 — dynamic active-course resolution, no hardcoded ids, config overrides

**Verdict: CONFIRMED for the `list_pending_assignments` path. The repo-level claim is
REFUTED, and the exception is NOT disclosed in any commit message on this branch.**

Dynamic inference — `_shared/nexus.ts:200-227`. No literal course id appears anywhere in the
file: `grep -rnE "'[0-9a-f]{8}-[0-9a-f]{4}-" supabase/functions/_shared/nexus.ts` → **no matches**.
Precedence is explicit at `:204-208`: `activeCourseIds` (pin) wins outright, `excludeCourseIds`
subtracts in both branches, `eraDays` (`:210`) overrides the default 14. Config is read from
`user_scheduling_prefs.config.assignments` at `execute-tool/index.ts:2678-2684`, wrapped in
`try/catch (_) { /* defaults */ }` so an unreadable config degrades rather than throws.
Per-call escape hatch `args.include_all_courses === true` at `:2685`.

**The hardcoded list is real and it is a different function:**

`supabase/functions/nightly-assignment-sync/index.ts:128-130`
```ts
const ACTIVE_COURSE_IDS: string[] = [
  '8036ebab-d1bc-460b-92b0-c45fb312a12e', // MIT — Applied Generative AI for Digital Transformation
];
```
Passed to Nexus as `courseIds: ACTIVE_COURSE_IDS` at `:171`.

This does not contradict the narrow claim (the tool's scoping has no ids in code) but it does
contradict the claim as you phrased it — "NO hardcoded course ids in code". Two findings:

1. **It is undisclosed.** `git log 0969b9d -1` says "ACTIVE-COURSE SCOPING — inferred, no ids in
   code" with no carve-out, and `06b0eba` and `826d310` do not mention it either. I found no
   statement anywhere on this branch acknowledging that a sibling function pins a course id.
   Since you flagged it as possibly "separate and disclosed": it is separate, it is **not**
   disclosed.
2. **The two disagree, and it is user-visible.** The tool's inference admits **two** courses;
   the nightly sync ingests **one**. So `list_pending_assignments` reports 13 "AI and Business
   Strategy" items as pending while the scheduler never creates tasks for any of them. The agent
   will name work the schedule will never place. There is now one hardcoded course-scope and one
   inferred course-scope in the same pipeline — the "extend, don't duplicate" hazard, and it is
   the config-authoritative rule's blind spot too (the hardcoded id is not user-changeable
   anywhere).

---

## C6 — sheet syncs write Nexus, refuse without token, counters only on success

**Verdict: CONFIRMED, all three parts, both functions. (Read-only; no sync was triggered.)**

### Writes to Nexus, not Supabase
`sync-mit-sheets/index.ts:3` and `sync-google-sheets/index.ts:3` both:
```ts
import { fetchNexusAssignments, createNexusAssignment, updateNexusAssignment, nexusWritesConfigured } from "../_shared/nexus.ts";
```
Writes go through `updateNexusAssignment` (mit `:271`, google `:288`) and
`createNexusAssignment` (mit `:293`, google `:311`).

Repo-wide check that no Supabase writer remains:
```
$ grep -rn "from('assignments')\|from(\"assignments\")" --include=*.ts .
(no matches)
```
Zero references to the `public.assignments` table remain in any edge function or client file.

### Refuses without `UAT_BYPASS_TOKEN`
`sync-mit-sheets/index.ts:183-188` (and `sync-google-sheets/index.ts:206-211`, identical):
```ts
if (!nexusWritesConfigured()) {
  console.error('[MIT_SHEETS] UAT_BYPASS_TOKEN missing — refusing to sync.');
  return new Response(JSON.stringify({ success:false,
    error: 'Nexus writes are not configured (UAT_BYPASS_TOKEN missing on this function). Nothing was written.',
  }), { status: 503, ... });
}
```
`nexusWritesConfigured()` is `_shared/nexus.ts:103-105` → `uatToken() !== null`. Guard sits
before any write. Returns 503 + `success:false`, not a hollow success.

### Counters only on success
- `updated++` (mit `:285`) is in the `else` of `if (!upd.ok) { ...failures.push... }`.
- `added++` (mit `:314`) is inside `if (newAssignment)`, and `newAssignment` is
  `ins.ok ? (...) : null` (`:309`) — so a failed insert cannot increment it.
- Aggregate honesty: `success: failures.length === 0` (mit `:360`, google `:379`), with the
  per-row `failures` array returned.

**One gap, minor:** if Nexus returns `ok` but a body shape the extractor cannot read,
`newAssignment` is `null` → `added` does not increment **and** nothing is pushed to `failures`.
That row vanishes from both counters silently. Narrow, but it is the same silent-success class
the commit set out to remove.

---

## C7 — one shared ordering function; assignment-vs-non-assignment left on score

**Verdict: CONFIRMED as stated. But the resulting comparator is intransitive — proven below.**

One definition, `_shared/nexus.ts:287-299` `courseworkOrder()`, imported by both consumers and
by nobody else:
```
execute-tool/index.ts:8          import { ..., courseworkOrder, courseworkBand, ... }
execute-tool/index.ts:2709       }).sort(courseworkOrder(orderOpts));
nightly-schedule-builder/index.ts:25    import { courseworkOrder } from "../_shared/nexus.ts";
nightly-schedule-builder/index.ts:788   const deadlineTriageOrder = courseworkOrder({...});
```
Used by the scheduler at `:793-795` (tierA/B/C array sorts), `:1356` (A/B within tier) and
`:1366` (C vs C). `grep` finds no second band/deadline comparator anywhere. No duplicate.

Assignment-vs-non-assignment deliberately on score — `index.ts:1362-1367` comment plus the
fall-through to the score branch at `:1368-1396`. Confirmed as described.

### DEFECT — the composed comparator is not a valid ordering

`Array.prototype.sort` requires a transitive comparator; this one mixes two incomparable
orderings, so it is not. Constructed from the real `courseworkOrder` export and the scheduler's
own branch structure, `now = 2026-09-03T12:00Z`:

- `C1` assignment, due 2026-09-05 (band 1, due soon), `score 10`
- `C2` assignment, due 2026-01-10 (band 4, old backlog), `score 90`
- `N`  non-assignment, no due date, `score 50`

```
C1 vs C2 (coursework branch): -3   -> C1 first
C2 vs N  (score branch):     -40   -> C2 first
N  vs C1 (score branch):     -40   -> N  first
=> C1 < C2 < N < C1 — a cycle
```

The observable consequence: the sorted result depends on the input order.

```
input C1,C2,N -> sorted C1,C2,N
input C2,N,C1 -> sorted C2,N,C1
input N,C1,C2 -> sorted N,C1,C2
input C1,N,C2 -> sorted N,C1,C2
input C2,C1,N -> sorted C1,C2,N
input N,C2,C1 -> sorted C2,N,C1
```
Six permutations of the same three tasks yield **three different orderings**. So the per-day
pick order is a function of the candidate query's row order, not of the tasks — which is the
exact class of "the queue order and the per-day pick order disagree" that `06b0eba` set out to
fix. The fix is correct for A/B-vs-A/B and C-vs-C; introducing a second ordering *inside* one
comparator is what breaks it. (This is a latent defect of the design decision, not a
misstatement of the claim.)

---
