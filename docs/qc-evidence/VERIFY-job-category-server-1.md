<!--
WHAT:          independent verification (round 1) of the SERVER/RULES half of the JOB-category change
               (claims 1-10 from the implementer), against docs/qc-evidence/AC-job-category.md.
WHY:           Tier 1 change (keyword gate decides scheduling windows and QC violations); needs a cold
               adversarial read that shares no context with the implementer.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      branch claude/jolly-archimedes-is9jyz @ 52c759f, diff 3995235..52c759f, commands quoted inline.
-->

# VERIFY job-category server, round 1

Scope: `supabase src/config src/lib src/utils src/integrations scripts .github`. Screens and Huddle out of scope.
Verified at: 52c759f (detached, in an isolated worktree). Verdicts appended as reached.

## Claim 9 -- `npm test` 490/490 green: CONFIRMED (test count); mutations: see the mutation section

`npm test` run by the verifier in this worktree at 52c759f, node v22.22.0:
```
# tests 490
# suites 67
# pass 490
# fail 0
```
Discovery includes the three new files (`categories.test.ts`, `category-guide.test.ts`, `keyword-rules.test.ts`);
the spelling-table suite reports `1..37` subtests passing.

## Claim 1 -- one category list; exact name maps to itself first: CONFIRMED (with two defects)

Observed (probe `node --experimental-strip-types probe.ts` importing `_shared/categories.ts` directly):
`JOB->JOB`, `job->JOB`, `PROF-EDUCATION->PROF_EDUCATION`, `prof_education ->PROF_EDUCATION`, `PERSONAL ->PERSONAL`,
`job hunt->CAREER`, `job-search->CAREER`. Exact match runs at `categories.ts:88-89` before any synonym rule.
Voice `RealtimeVoiceAssistant.normalizeCategory` now delegates to the shared function (diff read).

Defects found while trying to break it:
- **D-1 (minor, AC N-8 / G-8):** `normalizeCategory('networking')` -> `JOB` (substring `work`, `categories.ts:103`).
  AC section 3b N-8 says "never JOB by substring alone". `workout -> JOB` likewise. N-8 is not in `categories.test.ts`.
- **D-2 (minor, AC-E1):** `supabase/functions/notification-scheduler/index.ts:28` still declares a hand-written
  `category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION'` (no JOB, does not import the shared list). Type only.
- Pre-existing, not introduced: `permit`, `commitment`, `submit` -> EDUCATION (the old `mit` substring rule kept).

