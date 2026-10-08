-- =============================================================================
-- FIX: due_tomorrow reminder fired at 5am ET.
-- Root cause: `(NEW.due_date - INTERVAL '1 day')::date + TIME '09:00:00'` builds a
-- timestamp-without-tz at 09:00 that Postgres then stored as timestamptz in the DB's
-- UTC session → 09:00 UTC = 05:00 ET. Fix: interpret the day-before due date and the
-- 09:00 wall time in the USER's timezone (notification_prefs.timezone), so the reminder
-- lands at 9am local. Only the due_tomorrow reminder_time expression changed; everything
-- else is identical to 20260204162508.
-- =============================================================================

CREATE OR REPLACE FUNCTION schedule_task_reminders()
RETURNS TRIGGER AS $$
DECLARE
  reminder_time TIMESTAMPTZ;
  custom_reminder_minutes INTEGER;
  user_prefs RECORD;
  user_tz TEXT;
BEGIN
  SELECT * INTO user_prefs FROM notification_prefs WHERE user_id = NEW.user_id LIMIT 1;
  user_tz := COALESCE(user_prefs.timezone, 'America/New_York');

  IF NEW.status = 'DONE' OR NEW.completed_at IS NOT NULL THEN
    DELETE FROM scheduled_notifications
    WHERE task_id = NEW.id AND delivered_at IS NULL AND failed_at IS NULL;
    RETURN NEW;
  END IF;

  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    DELETE FROM scheduled_notifications
    WHERE task_id = NEW.id
      AND notification_type NOT IN ('task_created')
      AND delivered_at IS NULL AND failed_at IS NULL;

    -- START TIME REMINDERS
    IF NEW.start_time IS NOT NULL AND (user_prefs IS NULL OR user_prefs.due_reminders_enabled) THEN
      custom_reminder_minutes := COALESCE(NEW.reminder_minutes, 15);
      reminder_time := NEW.start_time - (custom_reminder_minutes || ' minutes')::INTERVAL;
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
        VALUES (NEW.user_id, NEW.id, 'task_start_reminder', reminder_time,
          'Task Starting Soon', 'Your task "' || NEW.title || '" starts in ' || custom_reminder_minutes || ' minutes');
      END IF;
      IF NEW.start_time > NOW() THEN
        INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
        VALUES (NEW.user_id, NEW.id, 'task_start_now', NEW.start_time,
          'Task Starting Now', 'Your task "' || NEW.title || '" is starting now');
      END IF;
    END IF;

    -- DUE DATE REMINDERS
    IF NEW.due_date IS NOT NULL AND (user_prefs IS NULL OR user_prefs.due_reminders_enabled) THEN
      -- 9am in the USER's timezone on the day before the (user-local) due date
      reminder_time := (((NEW.due_date AT TIME ZONE user_tz)::date - 1) + TIME '09:00:00') AT TIME ZONE user_tz;
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
        VALUES (NEW.user_id, NEW.id, 'due_tomorrow', reminder_time,
          'Task Due Tomorrow', 'Your task "' || NEW.title || '" is due tomorrow');
      END IF;

      reminder_time := NEW.due_date - INTERVAL '15 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
        VALUES (NEW.user_id, NEW.id, 'due_soon', reminder_time,
          'Task Due Soon', 'Your task "' || NEW.title || '" is due in 15 minutes');
      END IF;

      IF NEW.due_date > NOW() THEN
        INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
        VALUES (NEW.user_id, NEW.id, 'due_now', NEW.due_date,
          'Task Due Now', 'Your task "' || NEW.title || '" is due now');
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND (user_prefs IS NULL OR user_prefs.task_created_enabled = TRUE) THEN
    INSERT INTO scheduled_notifications (user_id, task_id, notification_type, scheduled_for, title, body)
    VALUES (NEW.user_id, NEW.id, 'task_created', NOW(),
      'New Task Created', 'Task "' || NEW.title || '" has been created');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
