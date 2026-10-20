# INVENTORY — parked work across the owner's repos

WHAT: a list of all PARKED work — commits on feature branches that never reached the main branch — across the owner's repos, with what each piece does, whether the owner approved it, whether it was ever live, and how it now relates to main.
WHY: owner 2026-10-20: "i do want a list of the rest of all parked work". Trigger: journey-voice branch origin/claude/huddle-journey-integration-xokgv1 holds ~7.7k lines of owner-approved Aug–Sep work (Nexus assignment reader, weekend-aware cap, nudges, task-dedup, meeting confirmation, overflow queue, notification fixes, 9am tz-aware due-tomorrow migration) that never merged; main's later deploys likely overwrote what had been deployed from it (confirmed for nightly-assignment-sync: live v246 = main's version, no Nexus calls).
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: read-only research pass 2026-10-20 (git fetch of all refs + unshallow; GitHub PR search; Supabase live edge-function source).

## Method (how "parked" was decided)

Squash merges are the norm, so ancestry is not trusted. For every remote branch B (ignoring `eds-wip/*`, `uat-shots`):
1. `git rev-list --count main..B` = 0 → ancestor of main, not parked.
2. **Unlanded-line count** (scratch script): every non-trivial line (>3 chars) that B *adds* relative to `merge-base(main,B)` is looked up in main's current copy of the same file. A line absent from main is "unlanded". `.claude/` and `docs/` are counted separately (ledgers/evidence) from code.
3. Branches with 0 unlanded code lines are treated as **content in main** (squash-merged, or ledger-only). Branches with unlanded code were then read by hand, and their PRs looked up.

Caveat (INFERRED): a line counts as "unlanded" if main later *rewrote* it, so a branch whose work was merged and then refactored on main will show a residual count. Each row below was read by hand to separate that from genuinely parked work.

