<!--
WHAT:          independent verification (round 2) of the SERVER/RULES half of the JOB-category change,
               re-deriving the loop-1 refutations (C2/D-3, D-1, D-2, D-4, D-6, D-7, N-1, Q-4) and re-checking C1, C3-C8.
WHY:           Tier 1 change (the keyword gate decides scheduling windows and QC violations). Loop 1 REFUTED C2
               (QC and scheduler used different weekend window sets) and found D-1..D-7; this round checks the fixes.
SUPERSEDES:    docs/qc-evidence/VERIFY-job-category-server-1.md (its REFUTED verdicts are re-derived here).
SUPERSEDED-BY: nothing -- current
EVIDENCE:      branch claude/jolly-archimedes-is9jyz @ cf9f680, diff 3995235..cf9f680, commands quoted inline.
-->

# VERIFY job-category server, round 2

Verifier started 2026-11-04 03:08 UTC. Code under test: `origin/claude/jolly-archimedes-is9jyz` @ `cf9f680` (detached).
Live DB: read-only SELECTs only on `wwxgajrtmslzklnyplah`. No writes, no deployed-function calls.

