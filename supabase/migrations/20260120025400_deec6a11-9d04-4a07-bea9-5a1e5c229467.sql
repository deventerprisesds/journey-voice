-- Create the trigger that was missing
DROP TRIGGER IF EXISTS sync_scheduled_calls_trigger ON user_scheduling_prefs;

CREATE TRIGGER sync_scheduled_calls_trigger
  AFTER INSERT OR UPDATE OF scheduled_calls, timezone
  ON user_scheduling_prefs
  FOR EACH ROW
  EXECUTE FUNCTION sync_scheduled_calls();

-- Manually sync all existing scheduled calls since the trigger was missing
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
    
    -- Schedule each enabled call
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