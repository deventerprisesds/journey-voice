-- Fix tasks stuck with status 'TODO' by mapping them to their correct category-based status
UPDATE tasks 
SET status = CASE
  WHEN category = 'CAREER' THEN 'CAREER'::task_status
  WHEN category = 'VENTURES' THEN 'VENTURES'::task_status  
  WHEN category = 'LIFE' THEN 'LIFE'::task_status
  WHEN category = 'EDUCATION' THEN 'PROF_EDUCATION'::task_status
  ELSE 'BACKLOG'::task_status
END
WHERE status = 'TODO'::task_status;