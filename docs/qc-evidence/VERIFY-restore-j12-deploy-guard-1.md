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

