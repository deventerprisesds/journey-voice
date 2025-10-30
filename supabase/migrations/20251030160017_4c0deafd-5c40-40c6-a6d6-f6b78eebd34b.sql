-- Fix existing scheduled tasks that have incorrect status and is_scheduled flag
UPDATE tasks 
SET is_scheduled = true, 
    status = CASE 
      WHEN category = 'EDUCATION' THEN 'PROF_EDUCATION'::task_status
      WHEN category = 'CAREER' THEN 'CAREER'::task_status
      WHEN category = 'VENTURES' THEN 'VENTURES'::task_status
      WHEN category = 'LIFE' THEN 'LIFE'::task_status
      ELSE status
    END
WHERE start_time IS NOT NULL 
  AND end_time IS NOT NULL 
  AND (is_scheduled = false OR status = 'BACKLOG');
