-- ============================================================================
-- SHADOW RUN — SETUP
-- ----------------------------------------------------------------------------
-- Clones a real user's scheduling world onto a synthetic "shadow" user so the
-- REAL nightly-schedule-builder can be run against it with NO dryRun flag.
--
-- Why this exists: dryRun is NOT faithful. The slotter re-reads is_scheduled
-- tasks from the DB itself, and that read is not dryRun-aware — so in a dry run
-- it collides with rows a real run would have CLEARED first (measured 2026-08-20:
-- 38 of 43 "overlaps_scheduled_task" rejections were these phantoms). Running the
-- real builder against a shadow user removes the artifact by construction: the
-- clear actually happens.
--
-- Isolation axis is user_id: tasks.user_id has NO FK to auth.users, and the
-- builder iterates users from user_scheduling_prefs. So a synthetic uuid is legal
-- and fully isolated.
--
-- SAFETY (all three matter — see teardown.sql):
--  1. NO profiles row for the shadow user  → the huddle-task-sync edge fn cannot
--     resolve an owner email, so shadow tasks never mirror into Huddle's board.
--  2. notification_prefs row with reminders/digests/task_created DISABLED → the
--     schedule_task_reminders trigger inserts nothing, so no pushes/notifications.
--  3. The user_scheduling_prefs row MUST be removed by teardown. The nightly cron
--     iterates EVERY row in that table, so a leftover shadow row would get
--     scheduled every night forever.
--
-- Params (replace before running, or use run.sh which substitutes them):
--   :source_user  the real user to clone
--   :shadow_user  the synthetic uuid
--   :scoring      'composite' | 'priority-rank'
-- ============================================================================

-- 1. Shadow board -------------------------------------------------------------
INSERT INTO public.boards (id, name, user_id, position)
VALUES (:'shadow_board'::uuid, 'SHADOW RUN — safe to delete', :'shadow_user'::uuid, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Scheduling prefs: clone config VERBATIM, override only the scoring model ---
--    Same timeWindows, categoryMappings (incl. maxPerDay), contextRules.
INSERT INTO public.user_scheduling_prefs (user_id, config, timezone)
SELECT :'shadow_user'::uuid,
       jsonb_set(config, '{scoringModel}', to_jsonb(:'scoring'::text)),
       timezone
FROM public.user_scheduling_prefs
WHERE user_id = :'source_user'::uuid
ON CONFLICT (user_id) DO UPDATE
  SET config = EXCLUDED.config, timezone = EXCLUDED.timezone;

-- 3. Suppress ALL notification side effects for the shadow user ----------------
INSERT INTO public.notification_prefs (
  user_id, due_reminders_enabled, overdue_reminders_enabled,
  daily_digest_enabled, weekly_digest_enabled, task_created_enabled,
  calendar_reminders_enabled, calendar_reminder_minutes, calendar_reminder_channels
)
VALUES (:'shadow_user'::uuid, false, false, false, false, false, false, 15, '{}')
ON CONFLICT (user_id) DO UPDATE
  SET due_reminders_enabled = false, overdue_reminders_enabled = false,
      daily_digest_enabled = false, weekly_digest_enabled = false,
      task_created_enabled = false, calendar_reminders_enabled = false;

-- 4. Clone every OPEN task ----------------------------------------------------
--    created_at is preserved deliberately: recency boost, staleness penalty and
--    the overdue-escalation age check all read it. New ids (pk), shadow board/user.
INSERT INTO public.tasks (
  title, description, status, priority, category, due_date, estimate_minutes,
  blocked_by, board_id, user_id, created_at, start_time, end_time, is_scheduled,
  reminder_minutes, scheduling_context, pushed_count, assignment_id,
  is_priority, priority_rank, assignment_url, assigned_agent, tags, definition_of_done
)
SELECT
  title, description, status, priority, category, due_date, estimate_minutes,
  blocked_by, :'shadow_board'::uuid, :'shadow_user'::uuid, created_at,
  start_time, end_time, is_scheduled,
  reminder_minutes, scheduling_context, pushed_count, assignment_id,
  is_priority, priority_rank, assignment_url, assigned_agent, tags, definition_of_done
FROM public.tasks
WHERE user_id = :'source_user'::uuid
  AND status::text NOT IN ('DONE','ARCHIVED')
  AND completed_at IS NULL;

-- 5. Clone calendar events so busy-time realism holds --------------------------
--    connection_id + calendar_id are NOT NULL — carry them over from the source.
INSERT INTO public.external_calendar_events (user_id, connection_id, calendar_id, title, start_time, end_time, is_all_day, external_event_id)
SELECT :'shadow_user'::uuid, connection_id, calendar_id, title, start_time, end_time, is_all_day,
       'shadow-' || external_event_id
FROM public.external_calendar_events
WHERE user_id = :'source_user'::uuid
  AND start_time >= now() - interval '1 day'
  AND start_time <  now() + interval '14 days';

-- 6. Report -------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.tasks WHERE user_id = :'shadow_user'::uuid) AS tasks_cloned,
  (SELECT count(*) FROM public.external_calendar_events WHERE user_id = :'shadow_user'::uuid) AS events_cloned,
  (SELECT config->>'scoringModel' FROM public.user_scheduling_prefs WHERE user_id = :'shadow_user'::uuid) AS scoring_model,
  (SELECT count(*) FROM public.profiles WHERE id = :'shadow_user'::uuid) AS profile_rows_must_be_zero;
