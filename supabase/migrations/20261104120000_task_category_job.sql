-- WHAT:          Adds JOB to public.task_category: work for the owner's employer, separate from CAREER
--                (which now means getting the next role).
-- WHY:           Owner 2026-11-03, after accepting a role at Trinnex: "all job tasks should go to job".
--                Permanent by design -- Postgres cannot drop an enum value -- and accepted by the owner.
-- SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:      docs/qc-evidence/AC-job-category.md AC-A1, AC-A2.
--
-- Nothing else in this migration may USE the new value: Postgres refuses a value added in the same
-- transaction. The data moves (the owner's five JOB tasks, Settings rows) run separately, afterwards.
ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'JOB';
