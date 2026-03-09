
-- Step 1: Update schedule_next_call to accept and use days_of_week
CREATE OR REPLACE FUNCTION public.schedule_next_call(
  p_user_id uuid,
  p_call_id text,
  p_call_name text,
  p_call_time time without time zone,
  p_call_context text,
  p_timezone text DEFAULT 'America/New_York'::text,
  p_comms_mode text DEFAULT 'phone'::text,
  p_days_of_week integer[] DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_local_date DATE;
  v_next_datetime TIMESTAMPTZ;
  v_notification_id UUID;
  v_day_of_week INTEGER;
  v_max_attempts INTEGER := 8;
  v_attempt INTEGER := 0;
BEGIN
  v_local_date := (NOW() AT TIME ZONE p_timezone)::DATE;
  v_next_datetime := (v_local_date + p_call_time) AT TIME ZONE p_timezone;
  
  -- If the time has already passed today, start from tomorrow
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((v_local_date + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
  END IF;

  -- Advance to the next valid day-of-week if days_of_week is specified
  IF p_days_of_week IS NOT NULL AND array_length(p_days_of_week, 1) > 0 THEN
    LOOP
      v_day_of_week := EXTRACT(DOW FROM (v_next_datetime AT TIME ZONE p_timezone))::INTEGER;
      EXIT WHEN v_day_of_week = ANY(p_days_of_week);
      v_next_datetime := v_next_datetime + INTERVAL '1 day';
      v_attempt := v_attempt + 1;
      EXIT WHEN v_attempt >= v_max_attempts;
    END LOOP;
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
      'comms_mode', p_comms_mode,
      'days_of_week', CASE WHEN p_days_of_week IS NOT NULL THEN to_jsonb(p_days_of_week) ELSE 'null'::jsonb END
    )::TEXT,
    v_next_datetime
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;

-- Step 2: Update sync_scheduled_calls to extract and pass daysOfWeek
CREATE OR REPLACE FUNCTION public.sync_scheduled_calls()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_call JSONB;
  v_call_id TEXT;
  v_call_name TEXT;
  v_call_time TIME;
  v_call_enabled BOOLEAN;
  v_call_context TEXT;
  v_comms_mode TEXT;
  v_timezone TEXT;
  v_days_of_week INTEGER[];
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
      
      -- Extract daysOfWeek array from JSON
      IF v_call ? 'daysOfWeek' AND jsonb_typeof(v_call->'daysOfWeek') = 'array' THEN
        SELECT array_agg(elem::INTEGER)
        INTO v_days_of_week
        FROM jsonb_array_elements_text(v_call->'daysOfWeek') AS elem;
      ELSE
        v_days_of_week := NULL;
      END IF;
      
      IF v_call_enabled AND v_call_time IS NOT NULL THEN
        PERFORM schedule_next_call(
          NEW.user_id,
          v_call_id,
          v_call_name,
          v_call_time,
          v_call_context,
          v_timezone,
          v_comms_mode,
          v_days_of_week
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$function$;
