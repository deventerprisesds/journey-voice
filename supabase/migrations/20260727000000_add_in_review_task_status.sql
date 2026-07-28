-- Add IN_REVIEW to task_status: agent-assigned work that's finished but awaiting the user's approval
-- before it can be marked DONE. Purely additive (mirrors how BLOCKED/LIFE/CAREER etc. were added) —
-- no existing rows/columns touched. Must be its own migration: a newly added enum value cannot be
-- referenced by a later statement in the SAME transaction (see the follow-on seed migration).
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'IN_REVIEW';
