CREATE OR REPLACE VIEW public.tasks_with_schedule AS
SELECT 
  t.id,
  t.title,
  t.description,
  t.status,
  t.priority,
  t.category,
  t.estimate_minutes,
  t.board_id,
  t.user_id,
  t.due_date,
  t.is_scheduled,
  t.external_event_id,
  t.pushed_count,
  t.assignment_id,
  t.scheduling_context,
  t.source_id,
  COALESCE(h.start_time, t.start_time) AS start_time,
  COALESCE(h.end_time, t.end_time) AS end_time,
  h.scheduled_date,
  h.action AS history_action,
  h.pushed_count AS history_pushed_count,
  true AS from_history,
  t.created_at,
  t.updated_at,
  t.completed_at
FROM public.task_schedule_history h
JOIN public.tasks t ON t.id = h.task_id
UNION ALL
SELECT 
  t.id,
  t.title,
  t.description,
  t.status,
  t.priority,
  t.category,
  t.estimate_minutes,
  t.board_id,
  t.user_id,
  t.due_date,
  t.is_scheduled,
  t.external_event_id,
  t.pushed_count,
  t.assignment_id,
  t.scheduling_context,
  t.source_id,
  t.start_time,
  t.end_time,
  NULL::text AS scheduled_date,
  NULL::text AS history_action,
  NULL::integer AS history_pushed_count,
  false AS from_history,
  t.created_at,
  t.updated_at,
  t.completed_at
FROM public.tasks t
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_schedule_history h WHERE h.task_id = t.id
);