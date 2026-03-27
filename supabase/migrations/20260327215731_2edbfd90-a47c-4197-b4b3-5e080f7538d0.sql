-- Drop the legacy 8-argument overload of insert_calendar_connection_for_user
-- Keep only the version that accepts _purposes to prevent PostgREST PGRST203 ambiguity
DROP FUNCTION IF EXISTS public.insert_calendar_connection_for_user(
  uuid, text, text, text, text, text, text, timestamptz
);

-- Ensure the 9-argument version with _purposes exists
CREATE OR REPLACE FUNCTION public.insert_calendar_connection_for_user(
  _user_id uuid,
  _provider text,
  _provider_account_id text,
  _provider_account_email text,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _scope text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL,
  _purposes text[] DEFAULT ARRAY['READ', 'WRITE']
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  connection_id uuid;
BEGIN
  INSERT INTO public.calendar_connections (
    user_id, provider, provider_account_id, provider_account_email,
    access_token, refresh_token, scope, expires_at, purposes
  ) VALUES (
    _user_id, _provider, _provider_account_id, _provider_account_email,
    public.encrypt_token(_access_token, _user_id),
    CASE WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token, _user_id) ELSE NULL END,
    _scope, _expires_at, _purposes
  ) RETURNING id INTO connection_id;

  PERFORM public.log_oauth_token_access(connection_id, 'created');
  RETURN connection_id;
END;
$$;