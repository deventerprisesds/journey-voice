# WHAT:       Verifier loop 3 for deadline-reminders, against the code AS MERGED on origin/main df7b192d (PR #143).
# WHY:        Re-confirm loop-2 CONFIRMED set at reduced depth, fully re-derive the AC-S2 doc fix, and check #142's blast radius.
# SUPERSEDES: .claude/VERIFY-deadline-reminders-2.md (on origin claude_verify-deadline-reminders-2).  SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   commands and outputs quoted per line below; base df7b192d.

- C1 suite on df7b192d: `node scripts/run-tests.mjs` -> `# tests 843 # pass 843 # fail 0`, rc=0. CONFIRMED.
- C2 merge changed no feature code: `git diff --stat a97a0eb8 df7b192d -- 'supabase/functions/notification-*' 'supabase/functions/_shared/deadline-reminders*' src/components/DeadlineRemindersSettings.tsx src/utils/deadlineReminders.ts` -> empty. Full a97a0eb8..df7b192d diff = 7 files: ac doc (1 line), docs/qc-evidence/probes/harness.ts (+limit() no-op), scripts/calendar-ignore-parity-gen.ts, _shared/calendar-ignore-parity.{fixture.json,test.ts}, execute-tool/index.calendar-ignore-section.test.ts, execute-tool/index.ts (+18: import loadIgnoreRules + `section === 'calendar_ignore'` early return). CONFIRMED.
