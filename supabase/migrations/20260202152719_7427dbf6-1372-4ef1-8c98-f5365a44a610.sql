-- Create function to update calendar connection tokens with explicit user_id
-- This is needed for edge functions using service role key
CREATE OR REPLACE FUNCTION public.update_calendar_connection_tokens_for_user(
  _connection_id uuid,
  _user_id uuid,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.calendar_connections 
  SET 
    access_token = public.encrypt_token(_access_token, _user_id),
    refresh_token = CASE 
      WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token, _user_id)
      ELSE refresh_token
    END,
    expires_at = COALESCE(_expires_at, expires_at),
    is_active = true,
    updated_at = now()
  WHERE id = _connection_id 
    AND user_id = _user_id;  -- Security: verify ownership
  
  IF FOUND THEN
    PERFORM public.log_oauth_token_access(_connection_id, 'refreshed_via_reauth');
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;