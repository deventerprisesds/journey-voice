-- ============================================================================
-- SHADOW RUN — TEARDOWN
-- ----------------------------------------------------------------------------
-- Removes every trace of a shadow run. Run this ALWAYS, even if the run failed.
--
-- The user_scheduling_prefs delete is the SAFETY-CRITICAL one: the nightly cron
-- iterates every row in that table, so a leftover shadow row would be scheduled
-- nightly forever. The final SELECT asserts all counts are zero — treat a
-- non-zero result as a failed teardown, not a warning.
--
-- Ordering: tasks first (they FK to boards), then the board.
-- ============================================================================

DELETE FROM public.scheduled_notifications WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.activity_log            WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.external_calendar_events WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.tasks                   WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.boards                  WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.notification_prefs      WHERE user_id = :'shadow_user'::uuid;
DELETE FROM public.user_scheduling_prefs   WHERE user_id = :'shadow_user'::uuid;

-- Assert clean. Every column MUST be 0.
SELECT
  (SELECT count(*) FROM public.tasks                    WHERE user_id = :'shadow_user'::uuid) AS tasks,
  (SELECT count(*) FROM public.boards                   WHERE user_id = :'shadow_user'::uuid) AS boards,
  (SELECT count(*) FROM public.user_scheduling_prefs    WHERE user_id = :'shadow_user'::uuid) AS prefs_CRITICAL,
  (SELECT count(*) FROM public.notification_prefs       WHERE user_id = :'shadow_user'::uuid) AS notif_prefs,
  (SELECT count(*) FROM public.scheduled_notifications  WHERE user_id = :'shadow_user'::uuid) AS notifs,
  (SELECT count(*) FROM public.external_calendar_events WHERE user_id = :'shadow_user'::uuid) AS events,
  (SELECT count(*) FROM public.activity_log             WHERE user_id = :'shadow_user'::uuid) AS activity;
