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

