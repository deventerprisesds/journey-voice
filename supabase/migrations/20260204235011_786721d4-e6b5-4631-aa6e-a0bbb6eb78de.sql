-- Update schedule_next_call function to accept and store p_comms_mode
CREATE OR REPLACE FUNCTION public.schedule_next_call(
  p_user_id uuid, 
  p_call_id text, 
  p_call_name text, 
  p_call_time time without time zone, 
  p_call_context text, 
  p_timezone text DEFAULT 'America/New_York',
  p_comms_mode text DEFAULT 'phone'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_local_date DATE;
  v_next_datetime TIMESTAMPTZ;
  v_notification_id UUID;
BEGIN
  v_local_date := (NOW() AT TIME ZONE p_timezone)::DATE;
  v_next_datetime := (v_local_date + p_call_time) AT TIME ZONE p_timezone;
  
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((v_local_date + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
  END IF;

  INSERT INTO scheduled_notifications (
    user_id, notification_type, title, body, scheduled_for
  ) VALUES (
    p_user_id,
    'scheduled_call',
    p_call_name,
    jsonb_build_object(
      'call_id', p_call_id,
      'call_name', p_call_name,
      'call_time', p_call_time::TEXT,
      'context', p_call_context,
      'timezone', p_timezone,
      'comms_mode', p_comms_mode
    )::TEXT,
    v_next_datetime
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- Update sync_scheduled_calls trigger to extract and pass commsMode
CREATE OR REPLACE FUNCTION public.sync_scheduled_calls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call JSONB;
  v_call_id TEXT;
  v_call_name TEXT;
  v_call_time TIME;
  v_call_enabled BOOLEAN;
  v_call_context TEXT;
  v_comms_mode TEXT;
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
      v_comms_mode := COALESCE(v_call->>'commsMode', 'phone');
      
      IF v_call_enabled AND v_call_time IS NOT NULL THEN
        PERFORM schedule_next_call(
          NEW.user_id,
          v_call_id,
          v_call_name,
          v_call_time,
          v_call_context,
          v_timezone,
          v_comms_mode
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;