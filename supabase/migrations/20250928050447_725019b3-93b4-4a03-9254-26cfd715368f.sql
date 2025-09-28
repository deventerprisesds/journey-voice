-- Fix the security definer view issue by creating a security definer function instead
DROP VIEW IF EXISTS public.calendar_connections_secure;

-- Create a secure function instead of a view to avoid security definer view warnings
CREATE OR REPLACE FUNCTION public.get_calendar_connections_secure()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  provider text,
  provider_account_id text,
  provider_account_email text,
  scope text,
  expires_at timestamp with time zone,
  is_active boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  access_token text,
  refresh_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the access
  PERFORM public.log_oauth_token_access(cc.id, 'accessed')
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
  
  -- Return decrypted tokens only for the owner
  RETURN QUERY
  SELECT 
    cc.id,
    cc.user_id,
    cc.provider,
    cc.provider_account_id,
    cc.provider_account_email,
    cc.scope,
    cc.expires_at,
    cc.is_active,
    cc.created_at,
    cc.updated_at,
    public.decrypt_token(cc.access_token) as access_token,
    CASE 
      WHEN cc.refresh_token IS NOT NULL THEN public.decrypt_token(cc.refresh_token)
      ELSE NULL
    END as refresh_token
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
END;
$$;