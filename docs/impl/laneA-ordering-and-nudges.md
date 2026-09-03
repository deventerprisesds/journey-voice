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
            live queries and command output quoted inline below.
-->

**Owned files (nothing else was touched):**

- `supabase/functions/_shared/nexus.ts`
- `supabase/functions/_shared/nudges.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`
- new committed tests beside the modules: `_shared/nexus.test.ts`, `_shared/nudges.test.ts`

**Scope owned:** AC-1.x (ordering), AC-4.x (duplicate digests), AC-7.x (nudge message at the
persistence site), AC-8.x (digest date bound + time format).

**Bottom line:** all four task groups implemented; 22 new tests, all collected by `npm test`
(73 pass repo-wide, 0 fail); 12/12 mutations FIRED, none INERT, none NOT-APPLIED. Nothing was
deployed and nothing was pushed. Three items need the owner: one behaviour change implied by
the ordering spec (§8.1), one live-data cleanup I did not perform (§8.2), and the fact that
every LIVE check remains unproven until this is deployed (§7).

---

## 0. Ground truth gathered before editing (commands run this session)

| # | Observation | Source |
|---|---|---|
| L1 | Live `public.scheduled_notifications` columns are exactly `id, user_id, task_id, notification_type, title, body, scheduled_for, delivered_at, failed_at, failure_reason, created_at, processing_at, processing_instance, queued_during_quiet, original_scheduled_for, metadata`. There is **no `status`** and **no `send_at`**. | Supabase MCP `execute_sql` on `information_schema.columns`, project `wwxgajrtmslzklnyplah` |
| L2 | `courseworkOrder` / `courseworkBand` / `COURSEWORK_BAND_LABEL` have exactly two importers: `execute-tool/index.ts:8` (tool output + `band` label) and `nightly-schedule-builder/index.ts:25` (placement). Changing the bands changes BOTH. | `grep -rn` over `*.ts`/`*.tsx` |
| L3 | `_shared/nexus.ts` already guards Deno (`typeof Deno !== 'undefined' ? Deno.env.get(...)`), so it imports under `node --experimental-strip-types`. Verified: `nexus import OK, exports: 15`. `_shared/nudges.ts` has no `Deno` reference at all. Neither needed a new guard. | `node --experimental-strip-types -e "import(...)"` |
| L4 | The venue-nudge template at `index.ts:1531` sat inside the window-plan block, BEFORE the placement loop — no `start_time` existed yet. The real persistence sites are the main write and the reshuffle-retry write, and BOTH have `slot.start_time` in scope. | file read |
| L5 | The overflow message was ALSO hardcoded outside `_shared/nudges.ts` (`index.ts:1470`). AC-7b's rule covers it, not only the venue one. | `grep -n "couldn't fit"` |
| L6 | `localDateToUtcBounds(localDate, tz)` was already imported by the builder and already used for timezone-safe bounds. AC-8a needed no new helper. | file read |
| L7 | The six live `venue_nudge` rows, captured for the test fixtures — five placed (Thu 20:15, Fri 17:45, Fri 18:15, Sat 16:00, Mon 18:00 ET) and one (`f6cb9caf` "Go to church") with `start_time = NULL, is_scheduled = false` carrying a nudge about a placement that never happened. **All six carried the identical placement-blind sentence.** | Supabase MCP `execute_sql` (query quoted in `nudges.test.ts`) |
| L8 | The eight real MIT coursework rows with their real ids and due dates (23:59:59Z, not midnight — this matters for band arithmetic). 7.1 already carries `2026-08-25` and the 8.1 Capstone `2026-09-01`. | Supabase MCP `execute_sql` (query quoted in `nexus.test.ts`) |

---

## 1. AC-1.x — ordering (`_shared/nexus.ts`, builder call site)

### 1.1 The bands, as implemented

```
band 1  due within soonDays (14)          -> soonest first
band 2  due beyond soonDays               -> soonest first
band 3  missed within recentDays (NOW 14) -> most recent miss first
band 4  missed beyond recentDays          -> OLDEST FIRST      <- direction reversed
band 5  undated                           -> always last
```

`DEFAULT_RECENT_OVERDUE_DAYS` 30 → **14**. `config.assignments.recentOverdueDays` still
overrides it per user, and both consumers already pass it through.

The rationale comment at the old `nexus.ts:255-257` argued the exact opposite of the owner's
decision (*"the oldest item is the least likely to still matter, so it must not lead"*). It has
been **rewritten**, not merely edited around, and now records: the owner's reversal, that it
governs PLACEMENT as well as display, and the owner-accepted consequence that 6.1 (16.5 days
late today) falls to band 4 and therefore sorts last.

**Output on the real MIT set at `now = 2026-09-03T12:00Z` — matches the owner's pinned list:**

```
8.1, 7.1, 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
```

Asserted twice: once through `courseworkOrder` (the path `list_pending_assignments` takes) and
once through `orderBuilderCandidates` (the path the scheduler takes), from a shuffled input so
a stable sort cannot fake it.

### 1.2 The band-2/band-4 trap the AC warned about

`nexus.ts:297` used one expression, `ba === 1 || ba === 3 ? da - db : db - da`, to serve two
bands at once — so reversing the backlog by flipping it would have silently reversed the other
band too. The within-band direction is now an **explicit per-band `switch`**, and `AC-1.2`
asserts all four dated directions in ONE test. Mutation M3 flips only band 3 and that test
fails, which is the proof the two are genuinely independent now.

A deterministic `id` tiebreak was added at the end of the comparator. Without it, two rows in
the same band with the same due date compared equal and the result then depended on the order
Postgres returned rows in — the same defect class as the intransitivity below, one level down.

### 1.3 The intransitive comparator — fixed at the cause, not the symptom

The verifier proved the builder's composed comparator was **not a valid ordering**: it switched
ordering RULE depending on the pair (coursework for assignment-vs-assignment, score for
everything else), giving `C1 < C2 < N < C1` and three different sorted orders from six
permutations of three tasks. `Array.prototype.sort` guarantees nothing on such a comparator, so
no amount of branch-tuning could fix it.

**What replaced it** (`orderSchedulingCandidates` + `orderBuilderCandidates` in `_shared/nexus.ts`,
called from the builder as a single line): compute ONE total order over the whole candidate set,
then compare precomputed integer ranks. Both original intents are preserved exactly:

| intent | before | now |
|---|---|---|
| Tier A/B lead, A before B, coursework order within tier | ✔ | ✔ unchanged |
| Tier C must not auto-jump priority-board work | ✔ via the score branch | ✔ the score branch still decides every assignment-vs-non-assignment position |
| assignment-vs-assignment reads in coursework order | ✔ but intransitively | ✔ assignments are permuted **among the slots score already gave them** — they take no slot from a non-assignment |

The ordering lives in `_shared/nexus.ts` and is exported as **one entry point the builder and
the tests both call**. That is deliberate: the accuracy log records that the last round proved
its ordering with a test on `courseworkOrder` in isolation while the defect lived in the
builder's composed comparator, which the test never touched. `AC-1.4` asserts antisymmetry and
transitivity over **every ordered triple** of a 19-item mixed fixture (all five bands, both
score branches, tier A/B/C and non-assignments), plus byte-identical output across 200
deterministic shuffles. Mutation M5 reinstates the old mixed-branch comparator and both AC-1.4
tests fail.

### 1.4 Blast radius, traced

`courseworkOrder` has exactly two importers (L2), and both move together by design — the owner
chose "work it first" as well as "show it first". The builder's own comment (`:781-787`), which
described the old four-band order, was updated in the same edit. `COURSEWORK_BAND_LABEL` was
renumbered alongside the bands so `execute-tool`'s `band` label still reads correctly
("recently overdue" is now band 3, "upcoming" band 2) with **no change needed in that file**.

---

## 2. AC-7.x — the nudge message moves to the persistence site

### 2.1 What was structurally wrong

The sentence was composed at window-plan resolution time, inside the placement loop but
**before a window was chosen and long before a `start_time` existed**, and it asserted the task
was scheduled outside working hours unconditionally. It was not badly worded; it was written at
a point in the program where the truth was not yet knowable. That string is what got persisted
into `scheduling_context.venue_nudge` and rendered verbatim by `DailyReviewModal.tsx:280`,
`src/utils/buildDayContext.ts:261` and `_shared/build-day-context.ts:262`.

### 2.2 What it is now

- `venueNudgeByTaskId` holds a **marker only** — `{ toWindow }`, no message. Its type changed,
  so a future attempt to stash a message there fails to compile.
- A new `buildVenueNudgePayload(marker, title, startISO)` helper is called at **both**
  persistence sites (the main write and the reshuffle-retry write — the second is easy to miss
  and a retry can land the task in a different window entirely). It calls
  `buildVenueNudgeMessage` from `_shared/nudges.ts` with the real slot.
- **A null message means no `venue_nudge` is stored at all.** This is the part that makes the
  three read surfaces agree with the digest: a placement the digest stays silent about now has
  nothing stored for the modal or the briefing to nag about. The verifier's headline finding
  was those two layers actively contradicting each other; they can no longer disagree, because
  there is exactly one string and one decision to emit it.
- The stored payload also carries `start_time`, so a reader can tell whether the sentence
  describes the current placement.

`AC-7c` asserts, over every real captured row, that the digest sentence and the persisted
sentence are the same string — and that "silent in one surface" means "silent in all".

### 2.3 No hardcoded nudge text outside `_shared/nudges.ts`

`grep -n "after work" supabase/functions/nightly-schedule-builder/index.ts` → **no matches**
(the one command the accuracy log names as what would have settled the last round, and which
was never run). The **overflow** sentence moved too — it was being composed inline in the
builder while the venue one lived in the shared module, which is precisely how the two drifted.
It is now `buildOverflowNudgeMessage`, with byte-identical output for the live case.

`AC-7b` asserts the builder source contains none of `after work`, `business hours slot`,
`most places close/open`, `couldn't fit`, `You could bump`. Mutation M9 pastes the old template
back and both AC-7a and AC-7b fail, naming the file.

---

## 3. AC-8.x — date bound, time format, working days, hour validation

- **AC-8a.** `placedToday` is bounded to the **digest's own local day** — the day the user will
  actually read it — via `localDayOf(digestAtIso, timezone)` → `localDateToUtcBounds(...)`. It
  had no date filter at all despite its name, so it returned every scheduled task the user had:
  the five live rows span 2026-09-03..09-07, meaning a Friday 08:00 digest nagged about a Monday
  placement and a Thursday one already past. The bounds are computed in the USER'S timezone —
  a UTC boundary looks right and is wrong for exactly the live `20:15 ET` row, which is
  `00:15Z the next day`; the test asserts that specific trap.
- **AC-8b.** `localTimeLabel` renders the real time **to the minute in am/pm** — `17:45` is now
  "5:45 pm", not "17:00". Asserted against all four real placements as exact strings.
  `localHourOf` also moved to `hourCycle: 'h23'`, removing the ICU midnight-as-"24" ambiguity
  the verifier flagged as a residual.
- **AC-8c.** `isNonWorkingDayLocal` reads the configured `business_hours.days` (the live value
  is `[1,2,3,4,5]`), falling back to Mon–Fri only when absent. The hours were config-driven
  while the days were hardcoded Sat/Sun, so a Tue–Sat user got the wrong branch twice a week.
  The builder now passes `days` through. Wording changed from "on the weekend" to "on a day
  off", which is the only user-visible consequence.
- **AC-8d.** `resolveDeliverHour` validates `config.nudges.deliverAtLocalHour`: anything that is
  not an integer in 0..23 falls back to 8 **and logs a warning**. `25`, `-1`, `NaN` and `"8am"`
  all used to fall through `nextLocalHour` to `return from.toISOString()` — send now, i.e. the
  1am push the hold-to-morning design exists to prevent. The test asserts no input in
  `[25, -1, NaN, '8am', null, undefined, 8, 0, 23, 7.5, '']` can produce an immediate send, and
  that `0` (midnight) is honoured rather than swallowed as falsy.

**Found while testing, not by review:** `buildVenueNudgeMessage` **threw** `Invalid time value`
on an unparseable `start_time`, inside the one try/catch that downgrades a throw to a
`console.warn` — so a single bad row would have silently switched the whole nudge feature off
for that user. Guarded (no parseable placement ⇒ no nudge) and mutation-proved (M12).

---

## 4. AC-4.x — duplicate digests, all three vectors

| vector | fix | test |
|---|---|---|
| 1 — every UI reschedule queued a full extra digest (`FocusView.tsx:642`, `DailyReviewModal.tsx:366` both pass `singleDay:true`) | delivery gated on `!dryRun && !singleDay`, with a log line when skipped | AC-4a (M7) |
| 2 — the computed `key` was written into the payload and never read | `deliverNudgeDigest` now reads the user's undelivered digests, and `planDigestDelivery` decides skip / insert / supersede from the keys | AC-4b (M11) |
| 3 — the purge filtered on `status` and `send_at`, **columns that do not exist** | rewritten against the real columns, `delivered_at is null` + `scheduled_for` bounds, failure now `console.error` with the PostgREST message | AC-4a (M8) |

**The suppression rule, stated once:** *a queued undelivered digest must EXACTLY match the
current nudge set; otherwise it is replaced.* Identical set ⇒ skip (so three taps of
"Reschedule today" cannot become three 08:00 pushes). Changed set ⇒ supersede: the stale rows
are deleted and exactly one is inserted, so the count of undelivered digests is never 2 — which
is also **AC-4d**, whose chosen policy is therefore *supersede*, not *skip*. Superseding carries
the CURRENT set, never a union with the old one: the caller has just recomputed from live rows,
so an item missing from it is no longer nudge-worthy and must not be resurrected.

Note on AC-4b's literal wording ("a second row IS created"): under supersede, a changed key
produces a **new row and removes the stale one**, so the row count stays 1 while the id and the
payload change. The test asserts both halves explicitly (`inserts.length === 2`,
`deletedIds.length === 1`, undelivered digest count still 1). If the owner wants two coexisting
rows instead, that is a one-line change to `planDigestDelivery` — but it reopens AC-4d.

**One deliberate interaction, worth knowing.** The purge runs only on a single-day rebuild, and
single-day rebuilds are now gated OUT of queueing a digest. A blanket purge would therefore mean
tapping "Reschedule today" at 07:00 silently destroyed the 08:00 digest the nightly run had
already queued. So the purge **excludes `metadata.source = 'nudges'`**, filtered in JS after a
select — a PostgREST `not(metadata->>source,eq,…)` filter cannot be used here because it
evaluates to NULL for the reminder rows that have no metadata, which would stop those being
purged at all. The stale-digest case is then handled by the supersede rule at the next nightly
run rather than by deletion.

---

## 5. Tests — committed beside the modules, collected, and mutation-proved

`supabase/functions/_shared/nexus.test.ts` (10 tests) and `_shared/nudges.test.ts` (12 tests).
Every fixture is REAL data with the capturing SQL and the capture date in a comment above it.

```
$ npm test
# tests 73   # suites 2   # pass 73   # fail 0
```

All 22 Lane-A tests are collected by Lane D's `scripts/run-tests.mjs` (verified by grepping the
run output for the AC-named tests, not by assuming the glob reached them — a committed test
that the runner never opens is the same false green as a checker reporting `uses=0`).

**How the tests reach the path the user's data takes.** The ordering tests call
`orderBuilderCandidates` — the function the builder itself calls — over the eight real MIT rows,
never `courseworkOrder` alone. The nudge tests start from the six real persisted `venue_nudge`
rows and end at the string the user reads, and `deliverNudgeDigest` is exercised against a
PostgREST-shaped fake so the real function's real query/insert/delete sequence runs. The parts
that live inside the Deno edge function (which node cannot import — it calls `Deno.serve` at
module scope) are asserted against **that file's source**, so reinstating any original defect
fails a named test; each of those is mutation-proved below rather than trusted.

### Mutation results — 12/12 FIRED, 0 INERT, 0 NOT-APPLIED

Anchors were supplied from a file, never as shell arguments; each anchor had to match exactly
once; each restore was asserted against a sha256 taken before the mutation. Harness:
`/tmp/.../scratchpad/mutate_lane_a.py` (it does not use `scripts/mutate.sh` only because that
tool refuses a file with uncommitted changes, and Lane A is required to leave its work in the
working tree).

| # | mutation (defect reinstated) | outcome | test that caught it |
|---|---|---|---|
| M1 | `recentDays` back to 30 | FIRED | AC-1.1, AC-1.3, AC-1.5, AC-1.6 |
| M2 | band 4 back to newest-first | FIRED | AC-1.2, AC-1.5, AC-1.6 |
| M3 | band 3 flipped (the shared-expression trap) | FIRED | AC-1.2, AC-1.5, AC-1.6 |
| M4 | boundary `<=` → `<` | FIRED | AC-1.3 |
| M5 | the intransitive mixed-branch comparator, reinstated | FIRED | both AC-1.4 tests |
| M6 | `placedToday` unbounded again | FIRED | AC-8a |
| M7 | `singleDay` gate removed | FIRED | AC-4a |
| M8 | purge back to `status` / `send_at` | FIRED | AC-4a |
| M9 | the placement-blind template pasted back | FIRED | AC-7a, AC-7b |
| M10 | time floored to the hour, 24h | FIRED | AC-8b, AC-8c |
| M11 | key-based suppression removed | FIRED | AC-4b |
| M12 | invalid-`start_time` guard removed | FIRED | AC-7a |

---

## 6. Symbol and syntax verification (not a green build)

`bun`/`esbuild` bundle cleanly with undefined identifiers, so a successful bundle proves
nothing. Three checks were run instead:

1. **`tsc --noEmit`** over all five files. The ONLY name-resolution errors (`TS2304`) are the
   pre-existing `Deno` global at `nexus.ts:35,99` and `builder:37,38,93,94,1117` — every one of
   them on a line I did not touch, and all of them behind a `typeof Deno !== 'undefined'` guard
   or inside the Deno runtime path. **Zero `TS2304` for any symbol this work introduced.**
2. **Per-symbol grep** of every identifier used in the edited regions against its
   import/declaration.
3. **esbuild bundle** of the builder — syntax only, and reported as such.

---

## 6b. One latent hazard closed while in the file

The verifier documented (§F5.b) that `const venueNudge = venueNudgeByTaskId.get(...)` at the
persistence site **shadowed the imported `venueNudge()` function** inside that block — safe only
because the digest code happens to sit outside that scope, and "one rename away" from a
`TypeError: venueNudge is not a function` that bundles perfectly and fails only at runtime, in
Deno, inside a catch that downgrades it to a `console.warn`. Since I was editing that exact
line, the local is now `venueNudgePayload` and no shadow remains: `grep -n "const venueNudge\b"`
returns nothing, and the only `venueNudge(` call in the file is the imported function in the
digest block. A regex symbol-checker could never have caught this class of bug.

---

## 7. What is NOT proven, and why

**Every live AC in my scope is UNPROVEN, deliberately.** The deployed `nightly-schedule-builder`
is version 217, built from the pre-change code, and the brief is explicit: do not deploy, do not
push. So the live checks — AC-1.5 (tool order via `pg_net`), AC-1.6 (dry-run placement order),
AC-4a/4b/4c (before/after row counts in `scheduled_notifications`), AC-7a (the SQL asserting no
row has a `venue_nudge` with a null `start_time`), AC-8a (digest item count) — would all be
measuring the OLD code today. They must be run **after** deploy, before this is called done.
Status until then: *implemented, mechanism verified offline and mutation-proved, NOT confirmed
live.*

Also not done, with reasons:

- **`scripts/check-nudge-single-source.mjs` (AC-7b part iii) was not created** — `scripts/` is
  outside Lane A's file ownership and Lane D is actively working there. The equivalent
  assertions live in `nudges.test.ts` (AC-7b) and run on every `npm test`, which is a *better*
  vehicle than a script someone has to remember to type, since Lane D's `checks.yml` runs
  `npm test` in CI. If the owner still wants the standalone script, it is a ten-line file.
- **The digest's overflow query is still unbounded** (`status = 'open'`, any `overflow_date`).
  AC-8a is specifically about `placedToday`, and narrowing the overflow scope would silently
  drop the live "Go to church" overflow item — a behaviour change nobody asked for. Flagged,
  not done.

---

## 8. Two things that need the owner

### 8.1 The spec's band ORDER changes precedence, beyond the direction change

**Observation.** The owner-final list numbers the bands `1 upcoming-soon, 2 future-beyond,
3 recently-missed, 4 old-backlog`. The code it replaces ordered them `1 due-soon,
2 recently-overdue, 3 future-beyond, 4 old-backlog`. Read as a precedence list — which is how a
band list works — **work due next March now outranks an assignment missed three days ago.**

**Interpretation (confidence: medium).** This may be exactly what was meant, or bands 2 and 3
may simply have been listed in a different order than the code numbered them. I implemented the
spec **literally**, because it is labelled final and says it supersedes the AC document.

**Why it changed nothing today, and when it will.** The live data has ZERO band-1 and ZERO
band-2 rows (verifier §C4: all 29 pending items are overdue or undated), so today's output is
identical either way and the owner's pinned list is reproduced exactly. The first time a
not-yet-due assignment appears, the two readings diverge visibly.

| option | what actually happens | reversible? |
|---|---|---|
| **Keep as implemented** (future beyond `soonDays` outranks a recent miss) | A February deadline sorts above a three-day-old miss, in the list AND in the schedule | yes — swap two `case` labels and two band numbers in `courseworkBand` |
| **Swap bands 2 and 3** (recent misses outrank far-future work, as the old code did) | The recent miss leads; far-future work sits behind it | yes, same one-line change |

*Recommendation, with its reason: swap them (recent misses ahead of far-future work). The whole
point of the band scheme is that a deadline you have already missed is more urgent than one four
months out, and the previous code's own comment says the two-band version was replaced precisely
because "a far-future item outranked a miss from three days ago". But this is the owner's spec
and I did not override it.*

### 8.2 The stale stored strings, including one that can never be rebuilt

All six live rows still carry the old placement-blind sentence (L7); they are overwritten the
next time each task is placed. The exception is `f6cb9caf` **"Go to church"**, which has
`start_time = NULL, is_scheduled = false`: the builder only writes `scheduling_context` when it
places a task, so that row's nudge will never be rebuilt and the Daily Review modal will keep
rendering the old sentence about a placement that never happened. AC-7a asserts the count of
such rows is zero, and code alone cannot get there.

I did **not** run this — it is a write to live user data, outside my file ownership and outside
"leave it in the working tree":

```sql
-- clears the orphaned marker only; touches nothing that has a placement
update public.tasks
   set scheduling_context = scheduling_context - 'venue_nudge'
 where user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   and scheduling_context ? 'venue_nudge'
   and start_time is null;   -- 1 row: f6cb9caf "Go to church"
```

The other five need no cleanup if the intent is "the next nightly run overwrites them"; if the
owner would rather no user ever sees the old sentence again, the same `-` operator with
`start_time is not null` clears them and the next run rewrites them correctly.
