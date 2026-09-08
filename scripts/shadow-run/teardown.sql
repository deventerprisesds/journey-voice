-- ============================================================================
-- SHADOW RUN — TEARDOWN
-- ----------------------------------------------------------------------------
-- ARCHIVE FIRST, THEN DELETE. Run this ALWAYS, even if the run failed.
--
-- Why the archive step exists: a teardown on 2026-08-20 deleted activity_log
-- (which holds the slotter_trace rows) before the rejection detail had been
-- reviewed. The counts survived in chat; the itemized "why was this task
-- dropped" evidence did not. Printing the rows was not enough — if the output
-- isn't captured it's still gone. So the diagnostics are now COPIED into durable
-- tables (public.shadow_runs / shadow_run_traces / shadow_run_schedule) that
-- teardown never touches.
--
-- The user_scheduling_prefs delete is SAFETY-CRITICAL: the nightly cron iterates
-- every row in that table, so a leftover shadow row would be scheduled nightly
-- forever. The final SELECT asserts all counts are zero — a non-zero result is a
-- FAILED teardown, not a warning.
--
-- Params: :run_label, :shadow_user
-- ============================================================================

-- STEP 1 — archive the produced schedule (shadow tasks are about to be deleted).
INSERT INTO public.shadow_run_schedule (
  run_id, title, category, priority, status, start_time, end_time,
  due_date, is_priority, is_scheduled, task_created_at)
SELECT r.run_id, t.title, t.category::text, t.priority::text, t.status::text,
       t.start_time, t.end_time, t.due_date, t.is_priority, t.is_scheduled, t.created_at
FROM public.tasks t
CROSS JOIN (SELECT run_id FROM public.shadow_runs WHERE label = :'run_label') r
WHERE t.user_id = :'shadow_user'::uuid;

-- STEP 2 — archive the slotter traces (the WHY-was-it-dropped evidence).
INSERT INTO public.shadow_run_traces (
  run_id, target_date, called_at, tasks_in, ai_proposed, accepted, rejected, busy_in)
SELECT r.run_id,
       a.metadata->'input'->>'targetDate',
       a.created_at,
       a.metadata->'input'->'tasks',
       a.metadata->'output'->'rawAI',
       a.metadata->'output'->'finalScheduled',
       a.metadata->'output'->'rejected',
       a.metadata->'input'->'busy'
FROM public.activity_log a
CROSS JOIN (SELECT run_id FROM public.shadow_runs WHERE label = :'run_label') r
WHERE a.user_id = :'shadow_user'::uuid AND a.activity_type = 'slotter_trace'
ORDER BY a.created_at;

-- STEP 3 — record totals on the run row.
UPDATE public.shadow_runs SET
  total_scheduled = (SELECT count(*) FROM public.tasks WHERE user_id = :'shadow_user'::uuid AND is_scheduled)
WHERE label = :'run_label';

-- STEP 4 — verify the archive captured something BEFORE destroying the source.
--          If traces_archived is 0 but the run really ran, STOP and investigate.
SELECT r.label, r.scoring_model, r.total_scheduled,
       (SELECT count(*) FROM public.shadow_run_traces   WHERE run_id = r.run_id) AS traces_archived,
       (SELECT count(*) FROM public.shadow_run_schedule WHERE run_id = r.run_id) AS schedule_rows_archived
FROM public.shadow_runs r WHERE r.label = :'run_label';

-- STEP 5 — delete. Tasks before boards (FK).
DELETE FROM public.scheduled_notifications  WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.activity_log             WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.external_calendar_events WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.tasks                    WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.boards                   WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.notification_prefs       WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.user_scheduling_prefs    WHERE user_id = :'shadow_user'::uuid;

-- STEP 6 — assert clean. Every column MUST be 0.
SELECT
  (SELECT count(*) FROM public.tasks                    WHERE user_id = :'shadow_user'::uuid) AS tasks,
  (SELECT count(*) FROM public.boards                   WHERE user_id = :'shadow_user'::uuid) AS boards,
  (SELECT count(*) FROM public.user_scheduling_prefs    WHERE user_id = :'shadow_user'::uuid) AS prefs_CRITICAL,
  (SELECT count(*) FROM public.notification_prefs       WHERE user_id = :'shadow_user'::uuid) AS notif_prefs,
  (SELECT count(*) FROM public.scheduled_notifications  WHERE user_id = :'shadow_user'::uuid) AS notifs,
  (SELECT count(*) FROM public.external_calendar_events WHERE user_id = :'shadow_user'::uuid) AS events,
  (SELECT count(*) FROM public.activity_log             WHERE user_id = :'shadow_user'::uuid) AS activity;
