-- Remove the redundant cron job that causes duplicate calls
SELECT cron.unschedule('twilio-scheduled-call-job');

-- Create function to schedule next call occurrence
CREATE OR REPLACE FUNCTION schedule_next_call(
  p_user_id UUID,
  p_call_id TEXT,
  p_call_name TEXT,
  p_call_time TIME,
  p_call_context TEXT,
  p_timezone TEXT DEFAULT 'America/New_York'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_datetime TIMESTAMPTZ;
  v_notification_id UUID;
BEGIN
  -- Calculate next occurrence in user's timezone
  -- Start with today's date at the scheduled time
  v_next_datetime := (CURRENT_DATE || ' ' || p_call_time)::TIMESTAMP AT TIME ZONE p_timezone;
  
  -- If that time has already passed today, schedule for tomorrow
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((CURRENT_DATE + INTERVAL '1 day') || ' ' || p_call_time)::TIMESTAMP AT TIME ZONE p_timezone;
  END IF;

  -- Insert into scheduled_notifications with UPSERT to prevent duplicates
  INSERT INTO scheduled_notifications (
    user_id,
    notification_type,
    title,
    body,
    scheduled_for
  ) VALUES (
    p_user_id,
    'scheduled_call',
    p_call_name,
    jsonb_build_object(
      'call_id', p_call_id,
      'call_name', p_call_name,
      'call_time', p_call_time::TEXT,
      'context', p_call_context,
      'timezone', p_timezone
    )::TEXT,
    v_next_datetime
  )
  ON CONFLICT (user_id, notification_type, scheduled_for) 
  DO UPDATE SET body = EXCLUDED.body
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- Create trigger function to schedule calls when preferences are updated
CREATE OR REPLACE FUNCTION sync_scheduled_calls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call JSONB;
  v_call_id TEXT;
  v_call_name TEXT;
  v_call_time TIME;
  v_call_enabled BOOLEAN;
  v_call_context TEXT;
  v_timezone TEXT;
BEGIN
  v_timezone := COALESCE(NEW.timezone, 'America/New_York');
  
  -- Clear any pending scheduled_call notifications for this user that haven't been delivered
  DELETE FROM scheduled_notifications
  WHERE user_id = NEW.user_id
    AND notification_type = 'scheduled_call'
    AND delivered_at IS NULL
    AND failed_at IS NULL;
  
  -- Schedule each enabled call
  IF NEW.scheduled_calls IS NOT NULL THEN
    FOR v_call IN SELECT * FROM jsonb_array_elements(NEW.scheduled_calls)
    LOOP
      v_call_id := v_call->>'id';
      v_call_name := v_call->>'name';
      v_call_time := (v_call->>'time')::TIME;
      v_call_enabled := COALESCE((v_call->>'enabled')::BOOLEAN, false);
      v_call_context := COALESCE(v_call->>'context', '');
      
      IF v_call_enabled AND v_call_time IS NOT NULL THEN
        PERFORM schedule_next_call(
          NEW.user_id,
          v_call_id,
          v_call_name,
          v_call_time,
          v_call_context,
          v_timezone
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on user_scheduling_prefs
DROP TRIGGER IF EXISTS trigger_sync_scheduled_calls ON user_scheduling_prefs;
CREATE TRIGGER trigger_sync_scheduled_calls
  AFTER INSERT OR UPDATE OF scheduled_calls, timezone
  ON user_scheduling_prefs
  FOR EACH ROW
  EXECUTE FUNCTION sync_scheduled_calls();

-- Initialize scheduled calls for existing users with scheduled_calls configured
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT user_id, timezone, scheduled_calls 
    FROM user_scheduling_prefs 
    WHERE scheduled_calls IS NOT NULL
  LOOP
    -- Trigger the sync function by doing a dummy update
    UPDATE user_scheduling_prefs 
    SET updated_at = NOW() 
    WHERE user_id = r.user_id;
  END LOOP;
END $$;