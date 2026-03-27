ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignment_id text;
CREATE INDEX IF NOT EXISTS idx_tasks_assignment_id ON public.tasks (assignment_id);