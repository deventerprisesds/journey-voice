-- Add assignment_url columns to store direct links to assignments
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assignment_url text;

ALTER TABLE public.assignments_mit
  ADD COLUMN IF NOT EXISTS assignment_url text;