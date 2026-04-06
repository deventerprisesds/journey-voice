
-- First, clean up FK references from dependent tables for duplicate assignments about to be deleted
-- Identify duplicates to delete (keep lowest id per user_id+sheet_row_number group)
WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignment_user_context WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignment_history WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignment_artifacts WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignment_outlines WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignment_requirements WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments a
  JOIN public.assignments b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.case_study_analyses WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

-- Now delete the duplicate assignments
DELETE FROM public.assignments a
USING public.assignments b
WHERE a.user_id = b.user_id
  AND a.sheet_row_number = b.sheet_row_number
  AND a.sheet_row_number IS NOT NULL
  AND a.id > b.id;

-- Delete duplicate assignments_mit rows (also clean history first)
WITH dupes_to_delete AS (
  SELECT a.id
  FROM public.assignments_mit a
  JOIN public.assignments_mit b
    ON a.user_id = b.user_id
    AND a.sheet_row_number = b.sheet_row_number
    AND a.sheet_row_number IS NOT NULL
    AND a.id > b.id
)
DELETE FROM public.assignments_mit_history WHERE assignment_id IN (SELECT id FROM dupes_to_delete);

DELETE FROM public.assignments_mit a
USING public.assignments_mit b
WHERE a.user_id = b.user_id
  AND a.sheet_row_number = b.sheet_row_number
  AND a.sheet_row_number IS NOT NULL
  AND a.id > b.id;

-- Add unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_user_row_unique
  ON public.assignments (user_id, sheet_row_number)
  WHERE sheet_row_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_mit_user_row_unique
  ON public.assignments_mit (user_id, sheet_row_number)
  WHERE sheet_row_number IS NOT NULL;
