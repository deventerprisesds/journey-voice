-- Phase 1: Unify MIT assignments into the main assignments table
-- MIT program id: 4793d933-86ca-4fd5-9b4d-e7a593a513a6

-- Step 0a: Drop the FKs to auth.users that violate the project convention
-- (other user-data tables do not have these; they block legitimate demo data)
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_user_id_fkey;
ALTER TABLE public.assignment_history DROP CONSTRAINT IF EXISTS assignment_history_user_id_fkey;

-- Step 0b: Replace the (user_id, sheet_row_number) unique constraint with one that
-- includes program_id, so EMBA and MIT can share row numbers from their separate sheets.
DROP INDEX IF EXISTS public.idx_assignments_user_row_unique;

CREATE UNIQUE INDEX idx_assignments_user_program_row_unique
  ON public.assignments (user_id, program_id, sheet_row_number)
  WHERE sheet_row_number IS NOT NULL;

-- Step 1: Copy MIT assignments into assignments table, preserving UUIDs
-- (zero UUID collisions confirmed in pre-flight)
INSERT INTO public.assignments (
  id, user_id, title, description, due_date, status, priority, type, category,
  course_id, program_id, assignment_url, sheet_row_number, academic_semester,
  level_of_effort, points, feedback, created_at, updated_at
)
SELECT
  m.id, m.user_id, m.title, m.description, m.due_date, m.status, m.priority, m.type, m.category,
  m.course_id, '4793d933-86ca-4fd5-9b4d-e7a593a513a6'::uuid AS program_id,
  m.assignment_url, m.sheet_row_number, m.academic_semester,
  m.level_of_effort, m.points, m.feedback, m.created_at, m.updated_at
FROM public.assignments_mit m
WHERE NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = m.id);

-- Step 2: Copy MIT history (currently empty, but future-proof)
INSERT INTO public.assignment_history (
  id, assignment_id, user_id, changed_at, changed_fields, old_values, new_values
)
SELECT
  h.id, h.assignment_id, h.user_id, h.changed_at, h.changed_fields, h.old_values, h.new_values
FROM public.assignments_mit_history h
WHERE NOT EXISTS (SELECT 1 FROM public.assignment_history ah WHERE ah.id = h.id);

-- Step 3: Rename deprecated tables for rollback safety
ALTER TABLE public.assignments_mit RENAME TO assignments_mit_deprecated;
ALTER TABLE public.assignments_mit_history RENAME TO assignments_mit_history_deprecated;