-- Seed an "In Review" column (status IN_REVIEW) on every default board that doesn't already have one.
-- Purely additive: no DELETE, no touching existing columns/tasks. Position is computed dynamically
-- (one past that board's current max position) instead of a hardcoded number, since boards may have
-- diverged from the original 9-column seed over time.
INSERT INTO public.columns (name, board_id, status, position)
SELECT 'In Review', b.id, 'IN_REVIEW'::task_status,
       COALESCE((SELECT MAX(c2.position) + 1 FROM public.columns c2 WHERE c2.board_id = b.id), 0)
FROM public.boards b
WHERE b.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM public.columns c WHERE c.board_id = b.id AND c.status = 'IN_REVIEW'::task_status
  );
