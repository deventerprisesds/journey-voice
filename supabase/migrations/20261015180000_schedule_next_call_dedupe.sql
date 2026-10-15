-- WHAT:       schedule_next_call books the next occurrence of a scheduled call ONLY if that exact
--             occurrence is not already pending, and the duplicate pending rows already in the
--             table are removed (keeping the earliest-created one).
-- WHY:        notification-delivery calls schedule_next_call once per delivered row. The function
--             inserted unconditionally, so once two rows existed for one call/day, each of them
--             booked its own copy of tomorrow -- the duplicate set copied itself forward forever.
--             Measured 2026-10-15 (scheduled_notifications, dev@enterpriseds.io): Morning Kickstart
--             3 rows/day and Business Hours Start 2 rows/day on every day Oct 13-16, created 1-2s
--             apart; the owner received 3 and 2 identical emails respectively each morning.
-- SUPERSEDES: the unguarded INSERT in both schedule_next_call overloads.
-- SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   .claude/actions.md ACT:kickstart-email-dupes.
--
-- The key is (user, call_id, scheduled_for) among rows still PENDING (not delivered, not failed).
-- body is TEXT holding jsonb_build_object(...)::TEXT, written only by this function for
-- notification_type='scheduled_call', so the ->> 'call_id' cast is safe on the rows it filters to.

CREATE OR REPLACE FUNCTION public.schedule_next_call(p_user_id uuid, p_call_id text, p_call_name text, p_call_time time without time zone, p_call_context text, p_timezone text DEFAULT 'America/New_York'::text, p_comms_mode text DEFAULT 'phone'::text, p_days_of_week integer[] DEFAULT NULL::integer[])
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

  -- Already booked? Return the existing row instead of adding a copy.
  SELECT id INTO v_notification_id
    FROM scheduled_notifications
   WHERE user_id = p_user_id
     AND notification_type = 'scheduled_call'
     AND scheduled_for = v_next_datetime
     AND delivered_at IS NULL AND failed_at IS NULL
     AND (body::jsonb ->> 'call_id') = p_call_id
   ORDER BY created_at
   LIMIT 1;
  IF v_notification_id IS NOT NULL THEN
    RETURN v_notification_id;
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

CREATE OR REPLACE FUNCTION public.schedule_next_call(p_user_id uuid, p_call_id text, p_call_name text, p_call_time time without time zone, p_call_context text, p_timezone text DEFAULT 'America/New_York'::text)
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
  v_local_date := (NOW() AT TIME ZONE p_timezone)::DATE;
  v_next_datetime := (v_local_date + p_call_time) AT TIME ZONE p_timezone;
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((v_local_date + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
  END IF;

  SELECT id INTO v_notification_id
    FROM scheduled_notifications
   WHERE user_id = p_user_id
     AND notification_type = 'scheduled_call'
     AND scheduled_for = v_next_datetime
     AND delivered_at IS NULL AND failed_at IS NULL
     AND (body::jsonb ->> 'call_id') = p_call_id
   ORDER BY created_at
   LIMIT 1;
  IF v_notification_id IS NOT NULL THEN
    RETURN v_notification_id;
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
      'timezone', p_timezone
    )::TEXT,
    v_next_datetime
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;

-- One-time cleanup: of each set of PENDING duplicates, keep the earliest-created row.
DELETE FROM scheduled_notifications d
 USING (
   SELECT id,
          row_number() OVER (
            PARTITION BY user_id, scheduled_for, (body::jsonb ->> 'call_id')
            ORDER BY created_at, id
          ) AS rn
     FROM scheduled_notifications
    WHERE notification_type = 'scheduled_call'
      AND delivered_at IS NULL AND failed_at IS NULL
 ) r
 WHERE d.id = r.id AND r.rn > 1;
