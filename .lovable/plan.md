
User wants:
1. Add full-width row below 2×2 grid with Assignments tile + backlog overflow line (no provenance badge)
2. Investigate why EMBA assignments aren't being scheduled
3. Q4 was about the "scoring threshold" message — investigate what threshold drops 4 LIFE tasks even when evening is empty

Let me investigate Q3 and Q4 before proposing fixes. Let me read the relevant files first.

Key files to inspect:
- `dailyReviewPipeline.ts` — where the "scored below scheduling threshold" message comes from
- `nightly-schedule-builder/index.ts` — actual builder logic and any minimum-score gate
- `src/lib/schedulingCandidates.ts` — already shown, scoring logic
- Plus DB query for assignment state

Let me batch reads + a DB query.
