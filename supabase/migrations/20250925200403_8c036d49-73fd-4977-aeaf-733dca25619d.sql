-- Insert BACKLOG column at position 1 (after BLOCKED) and adjust subsequent positions
-- First, update existing column positions to make room for BACKLOG
UPDATE public.columns 
SET position = position + 1 
WHERE position >= 1;

-- Insert BACKLOG column at position 1 for all boards
INSERT INTO public.columns (name, board_id, status, position)
SELECT 'Backlog', b.id, 'BACKLOG', 1
FROM public.boards b
WHERE NOT EXISTS (
  SELECT 1 FROM public.columns c 
  WHERE c.board_id = b.id AND c.status = 'BACKLOG'
);