# Acceptance criteria — nudge delivery, coursework ordering, config merge, guards

<!--
WHAT:       Verifiable, binary acceptance criteria for the nine owner-requested changes of
            2026-09-03 (ordering boundary + old-backlog direction, null due dates, course
            unpinning, duplicate digests, symbols guard, config merge, nudge message single
            source, nudge query/time format, committed tests).
WHY:        The previous round shipped on self-gathered evidence and an independent verifier
            refuted it (docs/verify/nudge-delivery-loop1.md). Its root cause is recorded in
            .claude/accuracy-log.md: "I fixed the site I was looking at, not the site the data
            flows through", and "a unit test on the new function is not evidence the
            user-visible behaviour changed".
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   docs/verify/nudge-delivery-loop1.md (independent verifier, head 826d310);
            .claude/accuracy-log.md; live queries and command output cited inline below.
-->

Author: independent AC subagent. No implementation was performed while writing this.
Repo `/home/user/journey-voice`, branch `claude/huddle-journey-integration-xokgv1`,
base head `3e4d630` (`git log --oneline -1`). Every "OBSERVED" line below was produced by a
command run in this session and is quoted verbatim; anything not observed is labelled
INFERENCE.

## How to read this

Each AC is `Given <context>, when <action>, then <observable outcome>` plus:

- **TIER** — 1 = decides a gate/score/placement, or admits model/inferred output into a stored
  claim (needs an independent verifier + mutation proof); 2 = ordinary logic; 3 = prose.
- **CHECK** — the exact command, query or file assertion that makes the AC binary.
- **REGRESSION** — what must be re-run to prove the AC has not silently rotted later.

**Standing rule for every AC in this document (from `.claude/accuracy-log.md`):** a test that
calls the new function directly is NOT sufficient evidence. Each AC's CHECK must exercise the
path the user's data actually takes — the persistence site and the read sites, not only the
derivation site. Where an AC can be satisfied by a unit test alone, it says so explicitly and
adds a second CHECK against the live path.

---

## Ground truth established before writing these ACs

| # | Observation | Source |
|---|---|---|
| G1 | `npm test` = `node --experimental-strip-types --test src/utils/*.test.ts`. Running it now: `# tests 11 / # suites 2 / # pass 11`. Both suites are in `src/utils/`. | `package.json`; `npm test` output |
| G2 | `supabase/functions/_shared/task-dedup.test.ts` exists (5938 bytes) and is **never executed** by `npm test` — the glob does not reach it. | `ls -la`, and G1's suite count of 2 |
| G3 | `node scripts/undef-check.mjs` with no args → prints nothing, `EXIT=0`. | command output |
| G4 | `node scripts/undef-check.mjs supabase/functions/_shared/nudges.ts` → `_shared uses=0 missing=none`, `EXIT=0` — a green pass on a file it did not examine. | command output |
| G5 | `node scripts/undef-check.mjs supabase/functions/execute-tool/index.ts` → `uses=3 missing=failures`, `EXIT=1`. The only `failures` occurrences are the English word in comments at `:1514` and `:1644`. | command output + `grep -n "\bfailures\b"` |
| G6 | Live `user_scheduling_prefs` for `a3378f93-…`: `config` keys are exactly `categoryMappings, contextRules, customAIInstructions, timeWindows, workingHours, workloadBalance`. `config->'dedup'`, `->'nudges'`, `->'assignments'` are all `null`. | Supabase MCP `execute_sql` |
| G7 | `mergeSchedulingConfig` (`src/config/schedulingRules.ts:287-308`) returns an object literal naming 8 fields. `priorityBoost` is declared in the `SchedulingConfig` interface (`:68`) and in `DEFAULT_SCHEDULING_CONFIG` (`:242`) but is **not** among the returned fields, so the merge cannot preserve it. `dedup` is not in the interface at all yet is read by edge functions. | file read; `grep -rn "priorityBoost"` |
| G8 | `config.dedup` is consumed server-side only — `_shared/task-dedup.ts:19`, `execute-tool/index.ts:882,1354`. No client type, no UI. Same shape as `nudges` and `assignments`. | `grep -rn "dedup"` |
| G9 | A weekly-cadence due-date inference **already exists** at `nightly-assignment-sync/index.ts:143-162` (`inferMissingDueDates`), tags rows `_due_date_inferred: true`, and logs each inference. AC-2 is therefore an EXTEND, not a new subsystem. | file read |
| G10 | `nightly-assignment-sync/index.ts:128-130` pins `ACTIVE_COURSE_IDS` to one literal uuid and passes it at `:171`. `_shared/nexus.ts` contains no uuid literal. | file read; verifier §C5 |
| G11 | `DailyReviewModal.tsx:279` already formats placement time as `hour:'numeric', minute:'2-digit', hour12:true` — the repo's existing am/pm convention — while rendering `venue_nudge.message` verbatim at `:280`. | file read |
| G12 | `courseworkOrder` has exactly two importers: `execute-tool/index.ts:8` (used at `:2709` and for the `band` label at the `enriched` map) and `nightly-schedule-builder/index.ts:25` (used at `:788` `deadlineTriageOrder`, applied at `:793-795`, `:1354`, `:1366`). Changing its defaults changes BOTH what Iris says and where the scheduler puts work. | `grep`, file reads |

---
## AC-1 — Ordering: `recentDays` 30 → 14, and band 4 sorts OLDEST FIRST

**Blast radius before anything else (this is Tier 1 and both consumers move together).**
`courseworkOrder` has exactly two importers (G12). Changing `DEFAULT_RECENT_OVERDUE_DAYS` and
band 4's direction changes (a) what `list_pending_assignments` tells the user, and (b) the order
`nightly-schedule-builder` PLACES coursework into the week (`deadlineTriageOrder`, applied at
`:793-795`, `:1354`, `:1366`). An AC that only proves the tool's output is half a proof.

### OBSERVED — the real MIT set, recomputed for both boundaries

`now = 2026-09-03T12:00Z`; 7.1/8.1 carry the AC-2 inferred dates (2026-08-25, 2026-09-01):

```
8.1 Capstone   due=2026-09-01 overdue=2.5d   band@14=2  band@30=2
7.1            due=2026-08-25 overdue=9.5d   band@14=2  band@30=2
6.1            due=2026-08-18 overdue=16.5d  band@14=4  band@30=2
5.1            due=2026-08-11 overdue=23.5d  band@14=4  band@30=2
4.1            due=2026-08-04 overdue=30.5d  band@14=4  band@30=4
3.1            due=2026-07-28 overdue=37.5d  band@14=4  band@30=4
2.1            due=2026-07-21 overdue=44.5d  band@14=4  band@30=4
1.1            due=2026-07-14 overdue=51.5d  band@14=4  band@30=4
```

**INTERPRETATION — the owner's stated expected list and `recentDays=14` disagree about 6.1.**
The owner wrote the expected result as `8.1, 7.1, 6.1, then 1.1, 2.1, 3.1 …`. Under
`recentDays=14` on today's date 6.1 is 16.5 days overdue, so it falls to band 4 and — under the
new OLDEST-FIRST direction — becomes the **last** row, not the third. Placing 6.1 third requires
`recentDays ≥ 17`. I searched for a `now` that satisfies the literal list under a 14-day
boundary and there is none: making 6.1 recent (`now ≤ 2026-09-01`) simultaneously makes 8.1
not-yet-overdue (band 1). **This is unresolved and is RISK-1 below. Do not pick one by
assumption — it changes the golden fixture the whole AC is scored against.** The ACs below are
written to the SHAPE the owner described (recent misses newest-first, then old backlog
oldest-first) with `now` pinned, so they are decidable either way once the owner answers.

### AC-1.1 — the boundary constant moves and is config-overridable
**Given** `_shared/nexus.ts` exports `DEFAULT_RECENT_OVERDUE_DAYS = 30`,
**when** the change lands,
**then** that export is `14`, and a caller passing `recentDays` (or
`config.assignments.recentOverdueDays`) still overrides it.
- **TIER 2.** A constant swap; the behaviour it drives is covered by 1.2–1.6.
- **CHECK:** `grep -n "DEFAULT_RECENT_OVERDUE_DAYS" supabase/functions/_shared/nexus.ts` shows
  `= 14`; plus a unit assertion that `courseworkBand({due_date:'2026-08-18'},{now:<2026-09-03>,
  recentDays:30})` is `2` while the same call with no `recentDays` is `4`.
- **REGRESSION:** the unit assertion above, run by `npm test` (see AC-9.2 — it must actually be
  collected, not merely committed).

### AC-1.2 — band 4 reverses to OLDEST FIRST; bands 1/2/3 do not move
**Given** four assignments in band 4 with due dates 2026-07-14, 07-21, 07-28, 08-04 and
`now = 2026-09-03T12:00Z`,
**when** they are sorted with `courseworkOrder({now})`,
**then** the output order is exactly `07-14, 07-21, 07-28, 08-04`; **and** the same test file
asserts band 1 and band 3 remain soonest-first and band 2 remains most-recent-miss-first.
- **TIER 1** — decides placement order in the nightly builder.
- **CHECK:** a committed unit test (AC-9) asserting all four band directions in ONE test, so
  reversing band 4 by flipping the shared `db - da` expression — which would silently reverse
  band 2 as well — fails immediately.
- **REGRESSION:** `npm test`. **Mutation proof required:** revert band 4 to newest-first, the
  named test MUST fail; revert band 2 to oldest-first, a DIFFERENT named test MUST fail. Two
  distinct failures, run via `scripts/mutate.sh` (anchors supplied from files, not shell args).

> **Adversarial note.** `courseworkOrder:297` currently reads
> `return ba === 1 || ba === 3 ? da - db : db - da;` — one expression serving bands 2 and 4
> together. The easy path is to flip that whole expression, which reverses band 2 too and still
> passes any test that only checks band 4. AC-1.2 exists specifically to make that fail.

### AC-1.3 — the exact-boundary case is decided explicitly, not by accident
**Given** an assignment due exactly `recentDays` days before `now` (delta = `-14 * 86400000` to
the millisecond),
**when** `courseworkBand` is called,
**then** it returns the band the owner chose (band 2 under the current `<=` reading), and a
committed test asserts BOTH sides of the boundary: `-14d + 1ms` and `-14d - 1ms` land in
different bands.
- **TIER 1** — one item crossing this boundary changes the head of the list and the order the
  scheduler places work.
- **CHECK:** unit test with three cases (exactly 14d, 14d−1ms, 14d+1ms) and an explicit comment
  naming which side the boundary is inclusive on.
- **REGRESSION:** `npm test`. **Mutation proof:** change `-delta <= recent` to `-delta < recent`
  (`nexus.ts:283`); the boundary test MUST fail.

### AC-1.4 — the comparator is a valid TOTAL ORDER (transitivity pinned)
**Given** the verifier's proof that the builder's composed comparator is intransitive — three
tasks `C1` (assignment, band 1, score 10), `C2` (assignment, band 4, score 90), `N`
(non-assignment, undated, score 50) produce `C1 < C2 < N < C1`, and six permutations of the same
three tasks yield **three different sorted orders** (verifier §C7),
**when** the ordering change lands,
**then** sorting those same three tasks is **permutation-invariant**: all 6 permutations produce
one identical output order.
- **TIER 1** — this is the difference between "the scheduler placed work in the owner's order"
  and "the scheduler placed work in the order Postgres happened to return rows".
- **CHECK:** a committed test that (i) builds a randomised set of ≥ 40 mixed
  assignment/non-assignment tasks spanning all five bands and both score branches, (ii) sorts
  every one of 200 random permutations with the **builder's actual comparator** (not
  `courseworkOrder` alone), and (iii) asserts all 200 results are byte-identical after mapping to
  ids. **Additionally** it must assert the comparator's own axioms directly over all ordered
  triples of a ~20-item fixture: antisymmetry (`cmp(a,b) === -cmp(b,a)`) and transitivity
  (`cmp(a,b)<=0 && cmp(b,c)<=0 ⇒ cmp(a,c)<=0`).
- **REGRESSION:** `npm test`. **Mutation proof:** reinstate the mixed-branch comparator exactly as
  it stands at `nightly-schedule-builder/index.ts:1352-1396`; the transitivity test MUST fail with
  a counterexample triple printed.

> **Adversarial note — this is the AC most likely to be gamed.** The permutation test alone can
> be satisfied by a stable sort over an already-nearly-sorted fixture. The explicit triple-wise
> axiom check is what makes it binary. A comparator that is merely "usually consistent" fails.
> Note also that the comparator under test must be the one the builder actually uses at
> `:1352-1396`, extracted so it is callable — testing `courseworkOrder` in isolation reproduces
> the exact mistake recorded in `.claude/accuracy-log.md` (the isolated function was never the
> broken thing).

### AC-1.5 — the tool's live output matches the pinned expectation
**Given** the deployed `list_pending_assignments` and the user's real Nexus data,
**when** it is invoked live for `a3378f93-d655-4913-b2fa-ca5b1d8020f1`,
**then** the returned rows, read top-down by their `band` label and title, match the order the
owner signs off in RISK-1 — recorded in this file as a literal expected list before the run, not
written down after seeing the output.
- **TIER 1.**
- **CHECK:** live invocation through `pg_net` (direct HTTPS to functions is blocked from this
  sandbox — the verifier's working method, §C4): `select net.http_post(url:='…/functions/v1/
  execute-tool', body:='{"toolName":"list_pending_assignments","userId":"a3378f93-…","args":{}}')`
  then read `net._http_response`. Paste the first 10 `{band, due_date, title}` rows into the
  verification report.
- **REGRESSION:** re-run the same invocation; ordering must be identical across two runs (this
  also re-proves AC-1.4 against real row order).

### AC-1.6 — the SCHEDULER's placement order changes too, and is observed
**Given** `courseworkOrder`'s defaults now differ,
**when** `nightly-schedule-builder` runs `{dryRun:true, singleDay:false}` for the real user,
**then** the run's logged assignment tier ordering reflects the new bands, and the AC report
states the before/after placement order for the 8 MIT items.
- **TIER 1** — this is the "fixed the site I was looking at, not the site the data flows
  through" trap from the accuracy log, applied to ordering.
- **CHECK:** invoke via `pg_net` with `{"userId":"a3378f93-…","dryRun":true}` (documented
  zero-write mode, proven safe by the verifier §F5.f), then read the function logs / the returned
  body for the tier ordering. A dry run that does not surface the order is not evidence — add the
  log line if it is missing.
- **REGRESSION:** the dry-run invocation, re-run after any later change to `_shared/nexus.ts`.

---
