# FINDINGS — Iris bulk "several priorities" message: who made the 40 journey tasks, who picked each category, why duplicates, why Iris said "only one added"

# WHAT:       diagnosis of the 2026-11-07 14:38Z Huddle 1:1 (dm-iris-chase) turn u-1794062312621 — a 23-line priority list that produced 40 journey tasks with mixed categories (JOB/LIFE/CAREER/VENTURES), and Iris's false 15:23Z recap.
# WHY:        owner: all 23 were work (Trinnex) tasks, yet they were filed across four categories, duplicated ~17 times with paraphrased titles, and Iris then claimed only one task was added.
# SUPERSEDES: nothing. Builds on (does not repeat) docs/qc-evidence/AC-job-category.md (category assigner table C-1..C-12) and EVAL-job-category-live-2026-11-04.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main journey-voice 3c5aee4, huddle-extension-app e0628702 (fetched 2026-11-08); live Supabase wwxgajrtmslzklnyplah read-only SELECTs; huddle azure-pg-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Diagnosis only. No production code, no deploy, no DB writes.

Status: IN PROGRESS

---
