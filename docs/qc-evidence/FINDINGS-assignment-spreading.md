# FINDINGS — why DBA assignments are not spread out and worked a little at a time

# WHAT:       fact-finding + fix plan for "assignments aren't being spread out and scheduled" — what TaskOS (journey-voice) reads from Nexus today (main + live), what is on the board, how the scheduler treats far-due work, what the parked restore code has, and the smallest fix.
# WHY:        owner 2026-10-28 (verbatim): "the assignments aren't being spread out and scheduled so I have been surprised about things due and not working on them a little at a time until done. That needs to be fixed before the rest ... Part of the problem may be not pointing to the correct tables in nexus from taskos."
# SUPERSEDES: nothing. Builds on (does not repeat) branch claude_schedule-sanity-timing docs/qc-evidence/RESEARCH-assignment-scheduling-history.md (E1–E14), DECISION-j5-j2-j8.md, RESTORE-J1-J15-diff.md; and branch claude_restore-j7-nexus-assignments docs/qc-evidence/RESTORE-step7-j7-scope.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main 9c81e5f (2026-10-28); live Supabase wwxgajrtmslzklnyplah read-only SELECTs 2026-10-28; nexus-hub db-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Fact-finding only. No production code, no deploy, no DB writes.

Status: IN PROGRESS (sections appended as completed)
