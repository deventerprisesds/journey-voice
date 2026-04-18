-- Add assignment_url column to tasks (referenced by Task TS interface and UI cards)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignment_url text;

-- Backfill from assignments table for any task linked to an assignment with a URL.
-- Idempotent: only updates rows where the task currently has a NULL URL.
UPDATE public.tasks t
SET assignment_url = a.assignment_url
FROM public.assignments a
WHERE t.assignment_id IS NOT NULL
  AND t.assignment_id = a.id::text
  AND t.assignment_url IS NULL
  AND a.assignment_url IS NOT NULL;