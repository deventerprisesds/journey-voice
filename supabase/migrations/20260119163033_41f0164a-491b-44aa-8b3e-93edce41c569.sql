-- Fix the schedule_next_call function - correct timestamp construction
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
  -- Combine today's date with the scheduled time properly
  v_next_datetime := (CURRENT_DATE + p_call_time) AT TIME ZONE p_timezone;
  
  -- If that time has already passed today, schedule for tomorrow
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((CURRENT_DATE + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
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