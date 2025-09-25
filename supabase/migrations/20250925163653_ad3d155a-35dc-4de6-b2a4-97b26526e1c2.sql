-- Expand task_status enum to support 9-column workflow
BEGIN;

-- Add new values to the task_status enum
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'CAREER';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'PROF_EDUCATION';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'VENTURES';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'PLANNING';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'UP_NEXT';

-- Note: DOING and DONE already exist, but let's make sure they're there
-- (these will be ignored if they already exist)
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'DOING';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'DONE';

COMMIT;