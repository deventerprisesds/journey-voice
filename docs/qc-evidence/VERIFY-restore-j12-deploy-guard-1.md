# VERIFY restore-j12-deploy-guard, loop 1

WHAT: an independent verification of journey-voice PR #64 (branch `claude_restore-j12-deploy-guard`, head `9e2babf`) against claims C1-C8 from the brief.
WHY: the PR is step 1 of a surgical restore; the owner's rule is that nothing main gained may be lost and every loss must be listed.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE: fresh clone in the verifier's scratchpad; every command below was run in this pass (2026-10-26).

Context observed at start: `origin/main` = `ae96cbb`, which is 3 commits past the PR base `aeef3d3` (PR #63, restore step 2: 7 migrations under `supabase/migrations/` plus a docs file). `comm` of the two changed-path lists is empty, and `git merge-tree --write-tree origin/main HEAD` is clean.

| # | Claim | Result |
|---|---|---|
| C1 | No `supabase/` path changes, so merging deploys nothing | **CONFIRMED** |

### C1 evidence
- `git diff --name-only origin/main...HEAD | grep -c '^supabase/'` -> `0`.
- `deploy-supabase-functions.yml` `on:` (parsed with `yaml.safe_load`): `push: {branches: [main], paths: ['supabase/functions/**']}` plus `workflow_dispatch`. No path in the PR matches.
- Every other workflow with a `push` or `workflow_run` trigger, parsed: `checks.yml` (push main / `claude/**` / `claude_**`, no paths: it WILL run on merge, read-only), `deploy-cloudflare.yml` (`paths: cloudflare/**`, not touched), `parse-edge-functions.yml` (`supabase/functions/**`, not touched), `check-edge-deploy-drift.yml` (`workflow_run` of the deploy, so it does not fire either).
- Note: a two-dot `git diff origin/main HEAD` lists 7 `supabase/migrations/*` files. Those are main's PR #63 additions that this branch predates; a merge keeps them (merge-tree clean), and migrations are not auto-applied by any workflow here.

## C2 -- nothing main had is lost: **CONFIRMED**

`git diff --numstat origin/main...HEAD`: only 4 files remove any line -- `deploy-supabase-functions.yml` (4), `read-widget-debug-log.yml` (28), `test-priorities-widget-query.yml` (163), `package.json` (1). `assert-ref-contains-main.sh` is `old mode 100644 / new mode 100755` with no content change. Every other file is pure addition.

| file | removed lines | accounted for by |
|---|---|---|
| `deploy-supabase-functions.yml` | the `function_name` description ("leave blank for changed functions") | record section 7 item 1 (blank dispatch now fails) |
| same | main's 3-line `fetch-depth` comment | equivalent: the new comment keeps main's reason verbatim in substance as point 1 and adds the guard reason as point 2; `fetch-depth: 0` unchanged (record item 6) |
| `package.json` | the inline `test` glob | record item 3; C3 below confirms the collector still runs `cloudflare/src/*.test.ts` |
| `read-widget-debug-log.yml` | the inline `python3 -c "..."` body | equivalent: body extracted from main's YAML text and diffed against `scripts/widget-debug-log-read.py` minus its header -> **identical (diff rc 0)** |
| `test-priorities-widget-query.yml` block 1 | inline body | vs `scripts/widget-priorities-queries.py` -> **identical (diff rc 0)** |
| `test-priorities-widget-query.yml` block 2 | inline body | vs `scripts/widget-error-log-read.py` -> one line differs: `else \"?\"` -> `else "?"`, which is exactly what bash's double-quoted `-c "..."` would have handed Python. Equivalent |

Shell-semantics check on the move to real files: the bodies contain no `$` or backtick (grep), and the only backslashes are `\n` inside Python strings, which bash double quotes pass through unchanged. All three scripts pass `python3 -m py_compile`. The env block (`SB_URL`, `SB_KEY`) is unchanged; the only added step is `actions/checkout@v4`, needed to reach `scripts/`.

No working behaviour existed to lose: main's copies of both widget workflows fail `yaml.safe_load` (`line 18, column 1` and `line 19, column 1`).

Step order in the new deploy workflow: checkout (26) -> guard (36) -> setup-cli (48) -> Resolve token (52) -> secret sync (61), so the guard's "runs BEFORE the secret syncs" comment is true.

## C3 -- `npm test` 291/291, `check:symbols` 0 new, guard test 7/7: **CONFIRMED**

Node v22.22.0, this branch's tree.
- `npm test` -> rc 0; `[run-tests] collected 25 test file(s)`; `# tests 291 / # pass 291 / # fail 0`. The 25 include `cloudflare/src/notify.test.ts` and `cloudflare/src/slack-events.test.ts` (main's glob root) plus `scripts/check-edge-deploy-drift.test.mjs` and `scripts/undef-check.test.mjs`.
- main's old glob on the same tree, run by hand: `# tests 286 / # pass 286 / # fail 0`. 286 + 5 new = 291, so nothing main ran was dropped.
- `npm run check:symbols` -> rc 0; `undef-check: 85 file(s) checked, 0 NEW undefined symbol(s), 1 known, 0 not analysable` (the known one is `send-chat-message/index.ts:buildCallContext`, per record C3).
- `bash scripts/assert-ref-contains-main.test.sh` -> rc 0; `assert-ref-contains-main: 7 passed, 0 failed`.

## C4 -- guard refuses xokgv1, passes origin/main and HEAD: **CONFIRMED at the PR base; HEAD is now REFUSED against current main (expected, not a defect)**

Full clone (`git rev-parse --is-shallow-repository` -> `false`).

| base | ref | rc |
|---|---|---|
| `origin/main` (`ae96cbb`) | `origin/claude/huddle-journey-integration-xokgv1` | **1** (`REFUSING TO DEPLOY ... is missing 67 commit(s)`) |
| `origin/main` (`ae96cbb`) | `origin/main` | **0** (`origin/main (ae96cbb) contains origin/main (ae96cbb)`) |
| `origin/main` (`ae96cbb`) | `HEAD` (this branch) | **1** -- `HEAD is missing 3 commit(s)`: `ae96cbb`, `b742cf4`, `590ce54` (PR #63) |
| `aeef3d3` (PR base) | `HEAD` | **0** (`HEAD (d74b6e9) contains aeef3d3`) |
| `aeef3d3` | xokgv1 | 1 |

Interpretation: the record's "HEAD -> rc 0" was true when written. main has since gained PR #63, so the branch no longer contains main and the guard correctly refuses it -- that is the guard working. Practical effect: a manual dispatch of the deploy from this branch is now refused until main is merged in. It matters for C7 only if `checks.yml` runs the guard against the PR's own ref (checked there).

## C5 -- blank dispatch exits 1; `all`, named function, push range unchanged: **CONFIRMED**

Method: `yaml.safe_load` each version (main = `git show origin/main:...`, branch = working tree), take the step with `id: changed`, substitute the four `${{ }}` expressions, assert none remain, run under `bash -e -c` (GitHub's default `run` shell) with `GITHUB_OUTPUT` pointed at a temp file, in this full clone so `git cat-file`/`git diff` resolve.

| case | main | branch |
|---|---|---|
| dispatch, blank | rc 0 `mode=all` ("Push range unavailable ... deploying all") | **rc 1**, no output, `::error::function_name is blank -- name a function or pass all.` |
| dispatch `all` | rc 0 `mode=all` | rc 0 `mode=all` |
| dispatch `execute-tool` | rc 0 `mode=single fn=execute-tool` | same |
| push, empty `before` | rc 0 `mode=all` | same |
| push, all-zeros `before` | rc 0 `mode=all` | same |
| push, unreachable `before` | rc 0 `mode=all` | same |
| push `990b60d^..990b60d` (#60) | rc 0 `mode=list fns=notification-delivery` | same |
| push `c11b1a2^..c11b1a2` (#59) | rc 0 `mode=all` (`_shared changed`) | same |
| push `b742cf4^..b742cf4` (docs-only) | rc 0 `mode=none` | same |

Every non-blank case is byte-identical between the two versions.

**Finding F1 (doc drift, not in the record's list):** `CLAUDE.md:16` on this branch (and main) still says the dispatch takes ``function_name`, blank = changed, "all" = force everything`` and offers it "for a manual re-run against a working branch". After this PR both halves are wrong: blank now fails, and a working branch that does not contain main is refused by the guard. The failure is safe (fails before any deploy), but the next agent that follows CLAUDE.md will hit a red run. The PR does not touch `CLAUDE.md`, and record section 7 does not mention it.

## C6 -- mutation proof: guard predicate **CONFIRMED (FIRED)**; blank-dispatch refusal **UNPROVEN (INERT)**

Both runs with `/usr/local/bin/mutate.sh`, anchor and replacement written to files, file clean before each.

**M1 -- reverse the ancestry check** in `scripts/assert-ref-contains-main.sh:51`.
anchor `if git merge-base --is-ancestor "$BASE_SHA" "$HEAD_SHA"; then` -> replacement `... "$HEAD_SHA" "$BASE_SHA"; then`; test `bash scripts/assert-ref-contains-main.test.sh`; must-fail = the check's own name `stale branch -> exit 1`.
```
FIRED: 'stale branch -> exit 1' failed with the defect reinstated. The guard is real.
restored: scripts/assert-ref-contains-main.sh matches HEAD
tree clean: 'stale branch -> exit 1' passes again on the restored tree (build output regenerated)
```

**M2 -- delete the blank-dispatch refusal** (the 4-line `elif [ "${{ github.event_name }}" = "workflow_dispatch" ]; then ... exit 1` block, asserted to occur exactly once) in `deploy-supabase-functions.yml`, replaced with nothing. Test = everything `checks.yml` runs: `npm test`, `npm run check:symbols`, `bash scripts/assert-ref-contains-main.test.sh` (wrapper prints `FAILED:blank-dispatch-suite` if any of the three fails).
```
The mutation DID apply and the suite exited 0, so this is a real result: the guard protects nothing.
restored: .github/workflows/deploy-supabase-functions.yml matches HEAD
```
Not an equivalent mutation: the mutant is the same shell logic as main's step, and C5 measured main's blank dispatch as `rc 0 mode=all` versus this branch's `rc 1`. So the behaviour change is real and **no test catches its removal**. `grep -rln 'deploy-supabase-functions|function_name is blank' scripts/ .github/workflows/checks.yml` -> nothing; no test reads the workflow file at all.

**Finding F2 (UNPROVEN guard):** the blank-dispatch refusal -- record section 7 item 1, the PR's one new behaviour -- is protected only by this verification's hand harness, not by any test in the repo. A later edit or a 3-way merge of the branch's `f13d7f7` deploy-loop hunk (the J4 candidate the record names) could drop it silently with `checks.yml` green.

