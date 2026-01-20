-- Fix schedule_next_call to use timezone-aware date calculation
CREATE OR REPLACE FUNCTION public.schedule_next_call(
  p_user_id uuid, 
  p_call_id text, 
  p_call_name text, 
  p_call_time time without time zone, 
  p_call_context text, 
  p_timezone text DEFAULT 'America/New_York'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_local_date DATE;
  v_next_datetime TIMESTAMPTZ;
  v_notification_id UUID;
BEGIN
  -- Get current date in USER'S timezone (not UTC!)
  v_local_date := (NOW() AT TIME ZONE p_timezone)::DATE;
  
  -- Calculate next occurrence using local date
  v_next_datetime := (v_local_date + p_call_time) AT TIME ZONE p_timezone;
  
  -- If that time has already passed today (in user's timezone), schedule for tomorrow
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((v_local_date + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
  END IF;

  -- Insert notification
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
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;

-- Re-sync all scheduled calls with the fixed function
DO $$
DECLARE
  v_prefs RECORD;
  v_call JSONB;
  v_call_id TEXT;
  v_call_name TEXT;
  v_call_time TIME;
  v_call_enabled BOOLEAN;
  v_call_context TEXT;
  v_timezone TEXT;
BEGIN
  FOR v_prefs IN 
    SELECT user_id, scheduled_calls, timezone 
    FROM user_scheduling_prefs 
    WHERE scheduled_calls IS NOT NULL
  LOOP
    v_timezone := COALESCE(v_prefs.timezone, 'America/New_York');
    
    -- Clear pending scheduled_call notifications for this user
    DELETE FROM scheduled_notifications
    WHERE user_id = v_prefs.user_id
      AND notification_type = 'scheduled_call'
      AND delivered_at IS NULL
      AND failed_at IS NULL;
    
    -- Schedule each enabled call with the fixed timezone logic
    FOR v_call IN SELECT * FROM jsonb_array_elements(v_prefs.scheduled_calls)
    LOOP
      v_call_id := v_call->>'id';
      v_call_name := v_call->>'name';
      v_call_time := (v_call->>'time')::TIME;
      v_call_enabled := COALESCE((v_call->>'enabled')::BOOLEAN, false);
      v_call_context := COALESCE(v_call->>'context', '');
      
      IF v_call_enabled AND v_call_time IS NOT NULL THEN
        PERFORM schedule_next_call(
          v_prefs.user_id,
          v_call_id,
          v_call_name,
          v_call_time,
          v_call_context,
          v_timezone
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;