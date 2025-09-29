-- Fix OAuth Token Security Issue
-- Remove the insecure SELECT policy that exposes encrypted tokens
DROP POLICY IF EXISTS "Users can view their own calendar connections via secure view" ON public.calendar_connections;

-- Create a secure view that excludes sensitive token fields (views don't support RLS directly)
CREATE OR REPLACE VIEW public.calendar_connections_safe AS
SELECT 
  id,
  user_id,
  provider,
  provider_account_id,
  provider_account_email,
  expires_at,
  scope,
  is_active,
  created_at,
  updated_at
FROM public.calendar_connections
WHERE user_id = auth.uid();  -- Built-in security filter

-- Update the existing secure function to improve security logging
CREATE OR REPLACE FUNCTION public.get_calendar_connections_safe()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  provider text,
  provider_account_id text,
  provider_account_email text,
  expires_at timestamp with time zone,
  scope text,
  is_active boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Log the safe access for security monitoring
  INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
  SELECT auth.uid(), cc.id, 'safe_view_access'
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid()
  LIMIT 1; -- Only log once per call
  
  -- Return safe connection data without sensitive tokens
  RETURN QUERY
  SELECT 
    cc.id,
    cc.user_id,
    cc.provider,
    cc.provider_account_id,
    cc.provider_account_email,
    cc.expires_at,
    cc.scope,
    cc.is_active,
    cc.created_at,
    cc.updated_at
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
END;
$function$;