# VERIFY — restore-j13-alarm-actions, loop 1 (journey-voice PR #65, head dca92b1)

WHAT: independent verification of PR #65 (J13 signed alarm action token + J14 FCM dead-token prune).
WHY: security-relevant — the PR mints tokens that let a phone change a task with no login.
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: own clone at head dca92b1; probes under docs/qc-evidence/probes/; Supabase MCP read-only.

Verifier started 2026-10-26 19:38 UTC, budget 50 min. Labels: O = observed, I = inferred.

| # | claim | result | evidence |
|---|---|---|---|
| C1 | only the stated files change; port == `git diff 0459770 nsishi` | **CONFIRMED** | see C1 |

## C1 — scope of the port (O)
- `git diff --name-only origin/main...HEAD` = exactly 7 paths: the record, `config.toml`, `_shared/action-token{,.test}.ts`, `alarm-action/index.ts`, `manage-push-subscription/index.ts`, `send-push-notification/index.ts`.
- `notification-delivery` and `notification-scheduler`: `git diff --stat origin/main...HEAD -- <both>` is empty.
- `git log 0459770..origin/main -- <6 paths>` is empty (main never touched them since the split).
- The 5 code files: blob ids at HEAD equal blob ids at `origin/claude/mobile-widget-web-bridge-debug-nsishi` (d1059fe) — byte-identical (acb76d8, 2286c6e, 348853e, ed9fc91, 0823e8e). `diff <(git diff origin/main HEAD -- <5>) <(git diff 0459770 nsishi -- <5>)` → identical.
- `config.toml` differs from the nsishi diff ONLY by commit 2's seven `verify_jwt=false` pins; the `[functions.alarm-action]` hunk is the nsishi hunk verbatim.
- Note: branch is 3 commits behind origin/main (migrations + a record only, no `supabase/functions/**`), so no merge interaction with these files.
