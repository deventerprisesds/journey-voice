-- Create a service-role-safe version of get_calendar_connection_tokens
-- that accepts user_id as parameter instead of relying on auth.uid()
CREATE OR REPLACE FUNCTION public.get_calendar_connection_tokens_service(
  _connection_id uuid,
  _user_id uuid
)
RETURNS TABLE(access_token text, refresh_token text, expires_at timestamptz, provider text, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Log the access using the safe helper (handles null auth.uid())
  PERFORM public.log_oauth_token_access(_connection_id, 'service_accessed');
  
  -- Return decrypted tokens, verifying the user owns the connection
  RETURN QUERY
  SELECT 
    public.decrypt_token(cc.access_token, cc.user_id) as access_token,
    CASE 
      WHEN cc.refresh_token IS NOT NULL THEN public.decrypt_token(cc.refresh_token, cc.user_id)
      ELSE NULL
    END as refresh_token,
    cc.expires_at,
    cc.provider,
    cc.user_id
  FROM public.calendar_connections cc
  WHERE cc.id = _connection_id AND cc.user_id = _user_id;
END;
$$;