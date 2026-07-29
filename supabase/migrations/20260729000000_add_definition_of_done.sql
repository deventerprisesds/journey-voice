-- WIP confirm-intent gate (docs/plan-wip-confirm-review-gate.md, Huddle repo, Part 1): the concrete,
-- testable Definition of Done the assigned agent confirms with the user before starting DOING work.
-- Purely additive column; flows through the existing huddle_task_sync trigger automatically since it
-- serializes the whole row (to_jsonb(NEW)) — no trigger change needed.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS definition_of_done TEXT;
