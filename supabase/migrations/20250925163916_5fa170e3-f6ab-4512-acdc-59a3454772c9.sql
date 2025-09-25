-- Update existing backfilled columns to use new 9-column structure
BEGIN;

-- Delete old default columns and recreate with new structure
-- First, delete tasks that reference the old columns (if any)
DELETE FROM public.tasks WHERE board_id IN (
  SELECT id FROM public.boards WHERE is_default = true
);

-- Delete old columns
DELETE FROM public.columns WHERE board_id IN (
  SELECT id FROM public.boards WHERE is_default = true
);

-- Create new 9-column structure for all default boards
INSERT INTO public.columns (name, board_id, status, position)
SELECT cols.name, b.id, cols.status::task_status, cols.position
FROM public.boards b
CROSS JOIN (
  VALUES 
    ('Blocked'::text, 'BLOCKED'::text, 0),
    ('Career', 'CAREER', 1),
    ('Prof. Education', 'PROF_EDUCATION', 2),
    ('Ventures', 'VENTURES', 3),
    ('Planning', 'PLANNING', 4),
    ('Ready', 'READY', 5),
    ('Up Next', 'UP_NEXT', 6),
    ('Doing', 'DOING', 7),
    ('Done', 'DONE', 8)
) AS cols(name, status, position)
WHERE b.is_default = true;

COMMIT;