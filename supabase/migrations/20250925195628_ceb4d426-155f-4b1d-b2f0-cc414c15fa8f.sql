-- Insert LIFE column at position 1 for boards missing it, and shift others
WITH boards_to_update AS (
  SELECT b.id
  FROM public.boards b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.columns c WHERE c.board_id = b.id AND c.status = 'LIFE'::task_status
  )
), shifted AS (
  UPDATE public.columns c
  SET position = c.position + 1
  FROM boards_to_update btu
  WHERE c.board_id = btu.id AND c.position >= 1
  RETURNING c.board_id
)
INSERT INTO public.columns (name, board_id, status, position)
SELECT 'Life', btu.id, 'LIFE'::task_status, 1
FROM boards_to_update btu;