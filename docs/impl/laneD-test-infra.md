# Lane D — test collector, symbols guard, CI

<!--
WHAT:       Progress + evidence log for Lane D: the `npm test` collector (AC-9.x), the
            `scripts/undef-check.mjs` symbols guard (AC-5.x), and the CI workflow that runs
            both (RISK-9).
WHY:        Measured 2026-09-03: `npm test` collects only `src/utils/*.test.ts`, so
            `supabase/functions/_shared/task-dedup.test.ts` (committed 2026-08-20) has never
            executed once. Every mutation proof in docs/ac/nudge-and-ordering-ACs.md runs
            through `npm test`, so without this fix no other AC has a vehicle. The guard is
            green on a file it never examined and red on a clean tree.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   docs/verify/nudge-delivery-loop1.md §F5; docs/ac/nudge-and-ordering-ACs.md G1-G5,
            AC-5a..5d, AC-9a..9d, RISK-9; command output quoted verbatim below.
-->

Repo `/home/user/journey-voice`, branch `claude/huddle-journey-integration-xokgv1`,
base head `611ceca`. Every line marked **OBSERVED** is verbatim command output produced in
this session. Anything else is labelled INFERENCE.

---

## Section 0 — baseline, measured before any edit

### 0.1 OBSERVED — `npm test` BEFORE

```
$ npm test          # = node --experimental-strip-types --test src/utils/*.test.ts
# tests 11
# suites 2
# pass 11
# fail 0
EXIT=0
```

Confirms G1 independently. The two suites are `src/utils/alarmDeepLink.test.ts` and
`src/utils/dailyReviewGuard.test.ts`.

### 0.2 OBSERVED — the committed-but-never-run suite

```
$ find src supabase -name '*.test.ts'
src/utils/alarmDeepLink.test.ts
src/utils/dailyReviewGuard.test.ts
supabase/functions/_shared/task-dedup.test.ts     <-- never collected
```

Three test files exist; the glob reaches two. Confirms G2.

### 0.3 OBSERVED — the uncollected suite runs fine when pointed at directly

```
$ node --experimental-strip-types --test supabase/functions/_shared/task-dedup.test.ts
# tests 10
# suites 0
# pass 10
# fail 0
```

**This is the important part.** `task-dedup.test.ts` was never broken and never needed a
fix — 10 passing assertions have simply been invisible for two weeks. Nothing was wrong
with the test; the runner never opened the file. (`# suites 0` because the file uses bare
`test()` calls, not `describe()` — node counts only `describe` blocks as suites. This is why
the AFTER numbers below move tests by +10 while suites stay at 2.)

---

## TASK 1 — AC-9.x, the test collector — **DONE, canary-proved**

### 1.1 The decision: why not just widen the glob

The obvious fix is `--test "src/**/*.test.ts" "supabase/functions/**/*.test.ts"`. It works —
measured, it collects all three files and reports 21 tests. **I rejected it**, on this
measurement:

```
$ node --experimental-strip-types --test "nosuchdir/**/*.test.ts"; echo "EXIT=$?"
# fail 0
EXIT=0
```

**OBSERVED: a glob matching ZERO files exits 0.** A widened glob fixes today's symptom and
leaves the failure *mode* fully intact — the next typo, directory rename, or well-meant
narrowing turns `npm test` green while executing nothing, and it is indistinguishable from a
passing suite. That is the same false green as reporting `tsc` silence as "typecheck clean"
when it had compiled zero files, and it is the same shape as `undef-check` printing
`uses=0 missing=none`: **the tool did not examine the thing, and said so in a way that reads
as approval.**

So the collector is a script that discovers files itself and **asserts a per-root floor**
before running anything.

| | Widened glob | `scripts/run-tests.mjs` (chosen) |
|---|---|---|
| Collects `supabase/functions` today | yes | yes |
| Prints what it collected | no | yes, every path |
| Exit code when it finds nothing | **0 — false green** | **2 — loud failure** |
| Survives a future path typo | no, silently | fails, naming the root |

Per-root floors, not one combined floor: a single total floor stays satisfied by the two
`src/` files alone, which is precisely how the edge-function suite went two weeks unnoticed.

### 1.2 OBSERVED — BEFORE and AFTER counts

| | command | tests | suites | pass | fail | exit |
|---|---|---|---|---|---|---|
| **BEFORE** | `node --experimental-strip-types --test src/utils/*.test.ts` | **11** | **2** | 11 | 0 | 0 |
| **AFTER** | `node scripts/run-tests.mjs` | **21** | **2** | 21 | 0 | 0 |

`# suites` stays 2 because `task-dedup.test.ts` uses bare `test()` rather than `describe()`,
and node counts only `describe` blocks as suites. **The count that moved is `# tests`: 11 → 21,
the ten assertions that had never run.** Anyone using `# suites` as the collection metric would
have concluded nothing changed — worth knowing before writing a CI assertion against it.

AFTER, the collector names its inputs:

```
[run-tests] collected 3 test file(s):
  - src/utils/alarmDeepLink.test.ts
  - src/utils/dailyReviewGuard.test.ts
  - supabase/functions/_shared/task-dedup.test.ts
```

### 1.3 OBSERVED — the CANARY, both outcomes

A deliberately failing test was written to
`supabase/functions/_shared/__collector_canary__.test.ts` — deliberately in the root that was
*previously never collected*, so a pass there proves the new reach and not merely that node
still works.

**Canary present — FIRED:**

```
[run-tests] collected 4 test file(s):
  - supabase/functions/_shared/__collector_canary__.test.ts
not ok 3 - CANARY: collector must report this as FAILING
  location: '.../supabase/functions/_shared/__collector_canary__.test.ts:6:1'
# tests 22
# pass 21
# fail 1
EXIT_WITH_CANARY=1
```

**Canary removed — restored to green:**

```
[run-tests] collected 3 test file(s):
# tests 21
# pass 21
# fail 0
EXIT_AFTER_REMOVAL=0
```

The canary file is **deleted**; `git status` shows no `__collector_canary__` file. A red suite
propagates a non-zero exit through the collector, so CI cannot mistake it for a pass.

### 1.4 OBSERVED — mutation proof of the collection floor

The defect the floor targets is "the glob silently stops reaching a root". Reinstated by
mutating the root path to a typo (`supabase/functions` → `supabase/functionz`):

| step | exit | result |
|---|---|---|
| baseline | 0 | 3 files collected, 21 pass |
| **mutation applied** | **2** | `! root "supabase/functionz" does not exist` — **FIRED** |
| restored | 0 | 3 files collected, 21 pass |

Under the rejected bare-glob design this same mutation exits **0**. That difference is the
entire justification for the script.

### 1.5 Deno-targeted modules — measured per file, nothing excluded

**The collector excludes nothing.** It collects every `*.test.ts` / `*.test.tsx` under both
roots with no allow-list, deny-list or per-file skip. There is no narrowed glob to hide behind,
so a test that cannot load surfaces as a loud failing test rather than as an absence.

I probed every `_shared` module by importing it under node (`node --experimental-strip-types
-e "import('./<f>')"`), rather than inferring from its source:

| module | node | note |
|---|---|---|
| `agenda-wrapper.ts` `audio-codec.ts` `build-day-context.ts` `call-session.ts` `config.ts` `nexus.ts` `nudges.ts` `scheduling-defaults.ts` `session-manager.ts` `task-dedup.ts` `timezone.ts` `tool-definitions.ts` `tool-executor.ts` `tts-manager.ts` | **LOADS (14)** | testable as-is |
| `call-context-builder.ts` | **FAILS** | `from 'https://esm.sh/@supabase/supabase-js@2'` |
| `persona.ts` | **FAILS** | same specifier |

**Sibling lanes are unaffected: `nudges.ts`, `nexus.ts`, `build-day-context.ts`,
`scheduling-defaults.ts` and `task-dedup.ts` all load under node.** Every module this work
needs to test is collectable today.

`nexus.ts` loads *because it already guards the global* —
`typeof Deno !== 'undefined' ? Deno.env.get('NEXUS_API_URL') : undefined` (`:35`, `:99`), with
a comment saying a bare top-level `Deno` reference would make the module unimportable. That is
the fixable-guard pattern, already applied.

**Genuine incompatibility, stated explicitly rather than papered over:**

- **All 52 edge-function `index.ts` entrypoints** import over `https://`. They **cannot** be
  imported by a node test at all. This is a real property of Deno-targeted code, not a
  collector shortcoming: testable logic has to live in a `_shared` module the entrypoint
  imports. `courseworkOrder` and `deliverNudgeDigest` already do; AC-1.4's builder comparator
  does **not**, and AC-1.4 explicitly requires it be "extracted so it is callable". **That
  extraction is a lane-owner task, not something the collector can supply** — flagging it here
  because AC-1.4 cannot be satisfied without it.
- **`call-context-builder.ts` and `persona.ts`** are `https://`-specifier failures. The fix
  *mechanism* is a `node:module` resolve hook rewriting `https://esm.sh/<pkg>@<v>` → `<pkg>`;
  I built one and confirmed it rewrites the specifier correctly. It still cannot complete
  **here**, for a reason that is not the hook's fault:

  ```
  $ ls node_modules/@supabase/supabase-js/
  (empty)
  ```

  The directory exists and contains nothing — consistent with the known-broken lockfile
  (`npm ci` 403s against Lovable's private registry). So: **fixable in principle, blocked in
  this sandbox by the missing package, and not needed by any current or planned test.** I did
  not ship the hook — it would add an unexercised, unprovable code path. If a lane later needs
  to test a module that imports `supabase-js`, this is the route and the blocker.
</content>

---

## TASK 2 — AC-5.x, the symbols guard — **DONE, mutation-proved**

### 2.1 OBSERVED — the three defects, reproduced verbatim before touching anything

```
$ node scripts/undef-check.mjs                                             ; echo EXIT=$?
EXIT=0                                                    <-- (a) silent pass, nothing printed

$ node scripts/undef-check.mjs supabase/functions/_shared/nudges.ts        ; echo EXIT=$?
_shared                    uses=0 missing=none
EXIT=0                                                    <-- (b) GREEN on a file it never read

$ node scripts/undef-check.mjs supabase/functions/execute-tool/index.ts    ; echo EXIT=$?
execute-tool               uses=3 missing=failures
EXIT=1                                                    <-- (c) RED on a clean tree

$ grep -n "\bfailures\b" supabase/functions/execute-tool/index.ts
1514:          // Silently ignore logging failures
1644:                  // Silently ignore logging failures
```

Ground truth on (c): **both occurrences are the English word inside a comment.** Not a symbol.

### 2.2 The root cause, and why appending symbols to the list was never the fix

(b) and (c) are not two bugs. They are one bug twice: **a hardcoded `required` array matched
with a bare regex against raw source.** The array was a frozen snapshot of commit `06b0eba`'s
symbols, so it was blind to every symbol added afterwards (b); and the regex could not tell code
from prose, so it accused a comment (c). Appending the six new names — the easy path AC-5b's
adversarial note calls out — fixes neither property and rots again on the next commit.

The rewrite removes the list entirely:

| | before | after |
|---|---|---|
| symbol source | hardcoded array of 8 names | **derived from the file under inspection** |
| comments/strings | matched as if code | blanked by a stack scanner before analysis |
| no arguments | exit 0 | **exit 2, with a usage message** |
| what it asserts | "these 8 names appear and are declared" | "every CALL resolves to a local binding, an import, or a known global" |

Restricting the check to **call sites** is what makes a list-free version tractable without a
real parser, and it is aimed squarely at the bug that motivated the guard: `courseworkOrder(...)`
and `getNexusRowsOnce(...)` were *called* without being imported. It also kills (c) for a second,
independent reason — `failures` in a comment is neither code nor a call.

### 2.3 OBSERVED — the three defects, after

| AC | command | result | exit |
|---|---|---|---|
| **5a** | `node scripts/undef-check.mjs` | `NO FILES GIVEN — nothing was checked, so this is a FAILURE.` + usage | **2** |
| **5b** | `node scripts/undef-check.mjs --verbose _shared/nudges.ts` | `examined=56 declared=72` — was `uses=0` | **0** |
| **5c** | `node scripts/undef-check.mjs execute-tool/index.ts` | `0 NEW undefined symbol(s)` | **0** |
| **5c** | `node scripts/undef-check.mjs --all` (69 files) | `0 NEW undefined symbol(s), 1 known` | **0** |

**AC-5b's `uses=0 ⇒ not checked` clause is enforced, and measured across the tree:**
minimum `examined` over all 69 files = **3**; files reporting `examined=0`: **0**. A file whose
analysis yields nothing at all prints `NOT-CHECKED` and fails the run — it can never read as a pass.

### 2.4 OBSERVED — mutation proofs (AC-5d)

Run with the org harness `scripts/mutate.sh`, **anchors supplied from FILES, never as shell
arguments**. Its first run returned `UNDETERMINED`, not a false `INERT` — it could not find a
recognised failure marker in this guard's own output format. That is the harness working as
designed; the fix was to add a `--tap` mode to the guard so it emits `not ok N - <symbol>`,
rather than to hand-roll a second harness and risk the exact NOT-APPLIED/INERT collapse the
accuracy log records.

| # | file | mutation | before | after | verdict |
|---|---|---|---|---|---|
| 1 | `_shared/task-dedup.ts` (clean, mutated **in place**) | call `normalizeTitleForDedup(title)` | 0 | 1 | **FIRED** — `restored: matches HEAD` |
| 2 | `_shared/timezone.ts` (clean, mutated **in place**) | call `resolveOlsonOffsetTable()` | 0 | 1 | **FIRED** — `restored: matches HEAD` |
| 3 | `_shared/nudges.ts` (**copy** — see note) | call `computeQuietHoursWindow(timezone)` | 0 | 1 | **FIRED**, symbol named at the right line |

Verbatim, mutations 1 and 2:

```
FIRED: 'normalizeTitleForDedup' failed with the defect reinstated. The guard is real.
restored: supabase/functions/_shared/task-dedup.ts matches HEAD

FIRED: 'resolveOlsonOffsetTable' failed with the defect reinstated. The guard is real.
restored: supabase/functions/_shared/timezone.ts matches HEAD
```

**Note on mutation 3, stated rather than silently substituted.** AC-5d names `_shared/nudges.ts`
specifically. At the time of the proof that file was **dirty — a sibling lane had 204 uncommitted
insertions in it** — and `mutate.sh` refuses a dirty file by design, because a failed restore
would be indistinguishable from the author's own edit. Forcing it would have destroyed another
lane's in-flight work. So mutation 3 ran against a byte-copy of the file's **current working-tree
content**, out of tree, with the anchor-application asserted explicitly (`assert s.count(a)==1`)
and the landed diff printed — so it cannot report `NOT-APPLIED` as `INERT`:

```
anchor occurrences: 1  (must be exactly 1, else NOT-APPLIED)
anchor APPLIED (1 occurrence replaced)
384a385
>   computeQuietHoursWindow(timezone);
...
  .../nudges.ts:385  computeQuietHoursWindow
EXIT_BEFORE=0    EXIT_MUTATED=1
```

`git diff --stat` afterwards shows only the sibling's 204 insertions — **Lane D changed nothing
in that file.**

### 2.5 OBSERVED — false-positive controls (AC-5c)

A probe file placing `failures(`, `courseworkOrder(`, `buildCallContext(`, `totallyUndefined(`
and `evening (after 7pm)` **only** inside line comments, block comments, single- and double-quoted
strings, a nested template literal and a regex literal, alongside real code using function-type
parameter annotations, a return-type annotation and a class method:

```
EXIT_PROBE_GOOD = 0      # every decoy ignored
```

Same file plus one genuinely undefined call:

```
.../probe-bad.ts:11  genuinelyUndefined
EXIT_PROBE_BAD  = 1      # caught
```

So the guard distinguishes prose from code, and still catches the real thing.

### 2.6 Analyser bugs found and fixed while proving it

The first full-tree run reported **11** findings. All 11 were ground-truthed by reading the cited
line — none was accepted or dismissed on inspection of the guard alone. Ten were the analyser's
fault, in three classes:

| class | example | why it misfired |
|---|---|---|
| return-type annotation between `)` and `{` | `private async callService(op: string): Promise<any> {` | the declaration regex `\)\s*\{` could not span `: Promise<any>`, so 5 `agenda-wrapper` methods read as calls |
| nested parens in a parameter list | `(cmp: (a: T, b: T) => number) =>` | `\([^()]*\)` cannot match it, so `cmp` was never bound (`nexus.ts`, `call-session.ts`, `tts-manager.ts`) |
| `${...}` content not re-scanned | `` `short-completed (${d}s)` `` nested in an interpolation | strings and templates *inside* an interpolation stayed unblanked, so English prose read as calls (`batch-calendar-scheduler`, `twilio-voice-handler`) |

Fixes: parenthesis-matching `functionHeads()` instead of regexes, `stripAnnotations()` so a
type annotation's names are not mistaken for bindings, and a **stack-based** `blankNonCode()`
that handles arbitrary template nesting. After the fixes: 11 → 1.

One incident worth recording because it will recur in a multi-lane branch: a finding
(`buildVenueNudgePayload`) appeared at line 1712 in one run and did not exist in the next. Its
declaration was at `:346` and its call at `:1732`. Cause: **a sibling lane was editing that file
between the two runs.** This is why the baseline below is keyed on `<path>:<symbol>` and never on
a line number.

### 2.7 The REAL DEFECT the guard found on its first honest run

The eleventh finding was not a false positive.

**OBSERVED**, in `supabase/functions/send-chat-message/index.ts`:

- `:69` opens `/* --- BEGIN LEGACY CODE (commented out for clarity) ---`
- `:328` closes it: `--- END LEGACY CODE */`
- `:252` `async function buildCallContext(...)` — **inside** that block comment
- `:498` `contextualInstructions = await buildCallContext(` — **outside** it, live code
- `:7` `const USE_SHARED_CONTEXT = true;` and `:473` `if (USE_SHARED_CONTEXT) {`

**INTERPRETATION (confidence: high; every line above was read, not inferred).** `buildCallContext`
does not exist at runtime — it is commented out. The call at `:498` sits in the `else` branch of
a `const`-true flag, so it is **unreachable today: nothing is broken in production.** What is
broken is the rollback path the comment block exists to serve — the header at `:61` says the
legacy code is "Preserved for rollback (USE_SHARED_CONTEXT = false)", and flipping that flag to
`false` throws `ReferenceError: buildCallContext is not defined` instead of rolling back. The
safety net is not attached.

Five sibling legacy functions (`getTodaysBriefing`, `getTasksForWindow`, `getTopicsForWindow`,
`formatTaskList`, `buildWindowTransitionContext`) are referenced only from inside the comment or
from the header comment itself — `buildCallContext` is the only one with a live call site, which
is exactly the one the guard reported.

**This is not Lane D's file and I did not edit it.** It is recorded in
`scripts/undef-check.baseline.json` — a ratchet, not a mute button:

1. every baselined finding is **printed loudly on every run**;
2. any finding **not** in the baseline fails the run;
3. a baseline entry that **stops reproducing also fails the run**, forcing its deletion — an
   exemption can never outlive the defect it covers.

Without the exemption, CI would be red from its first minute over a pre-existing defect in
another lane's file, which is how a guard gets ignored (AC-5c's stated concern). With it, the
tree is green, the defect is visible on every run, and any *new* undefined symbol fails.

**Owner action needed (not mine to take):** either delete the dead `else` branch at `:496-503`,
or move `buildCallContext` out of the comment block. Then delete the baseline entry — the guard
will fail until you do.

### 2.8 Stated limits of this guard

- **It is lexical, not a scope analyser.** It cannot see the shadowing hazard at
  `nightly-schedule-builder/index.ts:~1718` (`const venueNudge = ...` shadowing the imported
  function of the same name, verifier §F5.b). The name *is* bound there — just to the wrong
  thing. No regex checker closes that; it needs a real parser.
- **It checks call sites, not every reference.** `const x = someUndefinedValue;` is not caught.
  The motivating bugs were calls, and narrowing to calls is what keeps false positives at zero
  on a 69-file tree without a parser. Widening to all references without a scope analyser would
  reintroduce exactly the noise that made the old guard ignorable.
- **Scope is `supabase/functions/**` only.** `src/` is compiled by vite/tsc, which resolves
  identifiers already; running this there would duplicate a stronger check.

---

## TASK 3 — CI — **DONE**

### 3.1 OBSERVED — the gap

```
$ ls .github/workflows/ | wc -l
9
$ grep -rln "npm test\|undef-check\|node --test" .github/workflows/
(nothing)
```

Nine workflows, none running any check. Every "REGRESSION: caught in CI" line in the ACs was
aspirational (RISK-9).

### 3.2 What was added — `.github/workflows/checks.yml`

Triggers on push to `main` and `claude/**`, on every pull request, and on manual dispatch.
Two steps, both able to fail the run:

| step | command | fails the run when |
|---|---|---|
| Unit tests | `npm test` | any test fails, **or collection falls below a per-root floor** |
| Undefined-symbol guard | `npm run check:symbols` | any NEW undefined symbol, or a stale baseline entry |

`concurrency` + `cancel-in-progress` so a rapid series of pushes costs one run.
**No `continue-on-error` anywhere** — a check that cannot fail the run is decoration.

### 3.3 The install problem, and why this job does not have it

`npm ci` fails in this repo (the lockfile points at Lovable's private registry and 403s), so a
conventional `npm ci && npm test` job could never have run. It is not needed, and that is a
measured claim rather than a hopeful one — the imports of every collected test file are:

```
node:test          node:assert/strict
./task-dedup.ts    ./assignment-cadence.ts   ./nexus.ts
./alarmDeepLink.ts ./dailyReviewGuard.ts
```

Built-ins and repo-relative TypeScript. Nothing third-party. Both scripts likewise use only
`node:fs`, `node:path`, `node:url` and `node:child_process`.

**Proved by simulation rather than asserted:** the working tree was copied to a scratch
directory with `node_modules` and `.git` excluded — what a CI runner actually checks out — and
both steps were run there:

```
node_modules present in simulated checkout? 0 entries

$ npm test
[run-tests] collected 7 test file(s):
# tests 73   # pass 71   # fail 2      EXIT_TEST=1

$ npm run check:symbols
undef-check: 72 file(s) checked, 0 NEW undefined symbol(s), 1 known, 0 not analysable
EXIT_SYMBOLS=0
```

If a future test adds a third-party import, this job is where it surfaces — loudly, not silently.

---

## Final state

### The collector is already doing its job for the other lanes

Between the first run of this work and the last, sibling lanes committed **four** new test files.
The collector picked up every one with **no change to any glob, floor or config**:

| | test files | tests |
|---|---|---|
| start of this work | 2 collected (3 existed) | 11 |
| after the fix | 3 | 21 |
| at time of writing | **7** | **73** |

Collected now: `src/config/schedulingRules.test.ts`, `src/utils/alarmDeepLink.test.ts`,
`src/utils/dailyReviewGuard.test.ts`, `supabase/functions/_shared/assignment-cadence.test.ts`,
`supabase/functions/_shared/nexus.test.ts`, `supabase/functions/_shared/nudges.test.ts`,
`supabase/functions/_shared/task-dedup.test.ts`.

**Four of those seven are under `supabase/functions/` — the root that collected nothing before.**

### Test status — RESOLVED during this session (recorded so the transition is not lost)

An earlier run in this session showed two failures, both in another lane's in-flight file:

```
not ok 44 - AC-7a a task with no start_time can raise no venue nudge at all
            supabase/functions/_shared/nudges.test.ts:99    error: 'Invalid time value'
not ok 53 - AC-4a a single-day rebuild queues no digest, and the purge uses columns that exist
            supabase/functions/_shared/nudges.test.ts:342
```

Neither was Lane D's file; neither was fixed or worked around here. That lane has since resolved
both. **Final measured state:**

```
$ npm run check
[run-tests] collected 7 test file(s):
# tests 73   # pass 73   # fail 0
undef-check: 72 file(s) checked, 0 NEW undefined symbol(s), 1 known, 0 not analysable
exit=0
```

The point worth keeping: **before this change `npm test` would have exited 0 with both of those
defects present and unseen.** They were visible, and then fixed, only because the collector now
opens the file.

### Files Lane D changed

| file | status |
|---|---|
| `package.json` | `"test"` now runs the collector; added `check:symbols` and `check` |
| `scripts/run-tests.mjs` | **new** — collector with per-root floors |
| `scripts/undef-check.mjs` | rewritten — list-free, comment/string-aware, fails loudly on no input |
| `scripts/undef-check.baseline.json` | **new** — ratchet for the one real pre-existing defect |
| `.github/workflows/checks.yml` | **new** — runs both on push/PR |
| `docs/impl/laneD-test-infra.md` | this file |

Nothing under `src/` or `supabase/functions/` was modified. No `*.test.ts` was written or moved
(the canary was created and deleted inside one verification step). Nothing was deployed.

**Note on commit state, since it changed under this lane mid-session:** Lane D made no commit and
no push. A coordinating/sibling agent committed the whole four-lane working tree as `8fe3dc4`
*"wip: four-lane implementation snapshot — NOT verified, NOT deployed"* and pushed it to
`origin/claude/huddle-journey-integration-xokgv1`, which is why `git status` is clean. Verified by
`git fetch` + `git branch -r --contains 8fe3dc4`. Edge functions deploy on push to `main` only, so
nothing reached production.

### Open items for others

1. **`send-chat-message/index.ts`** — `buildCallContext` is called at `:498` but declared only
   inside the block comment at `:69-328`. Latent today (`USE_SHARED_CONTEXT` is a const `true`),
   but the documented emergency-rollback path is broken. Delete the dead `else` at `:496-503` or
   move the function out of the comment, then delete the baseline entry — the guard fails until
   the entry goes.
2. **`_shared/nudges.test.ts`** — two failing tests, above.
3. **AC-1.4** needs the nightly builder's composed comparator extracted into an importable
   `_shared` module. Edge-function `index.ts` files import over `https://` and **cannot** be
   loaded by a node test at all, so that AC is untestable until the extraction happens. Lane
   owner's call, not the collector's.
