-- Backfill default boards and columns for existing users
BEGIN;

-- 1) Create a default board for any profile that does not have one
INSERT INTO public.boards (name, description, user_id, is_default, position)
SELECT 'Personal Tasks', 'Your main task board', p.user_id, true, 0
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.boards b WHERE b.user_id = p.user_id
);

-- 2) Create default columns for boards that currently have no columns
WITH target_boards AS (
  SELECT b.id
  FROM public.boards b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.columns c WHERE c.board_id = b.id
  )
)
INSERT INTO public.columns (name, board_id, status, position)
SELECT cols.name, tb.id, cols.status::task_status, cols.position
FROM target_boards tb
CROSS JOIN (
  VALUES 
    ('Backlog'::text, 'BACKLOG'::text, 0),
    ('To Do', 'TODO', 1),
    ('In Progress', 'DOING', 2),
    ('Done', 'DONE', 3)
) AS cols(name, status, position);

COMMIT;