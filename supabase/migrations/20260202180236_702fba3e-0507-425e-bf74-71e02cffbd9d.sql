-- Phase 1: Add calendar connection purposes and sync token columns
-- Add purposes column to track READ/WRITE capabilities for each connection
ALTER TABLE public.calendar_connections 
ADD COLUMN IF NOT EXISTS purposes TEXT[] DEFAULT ARRAY['READ', 'WRITE'];

-- Add sync_token column for delta sync (stores Microsoft deltaLink or Google syncToken)
ALTER TABLE public.calendar_connections 
ADD COLUMN IF NOT EXISTS sync_token TEXT;

-- Migrate existing connections to have both purposes (backward compatible)
UPDATE public.calendar_connections 
SET purposes = ARRAY['READ', 'WRITE'] 
WHERE purposes IS NULL;

-- Add source_task_id to external_calendar_events to link outbound events back to tasks
ALTER TABLE public.external_calendar_events 
ADD COLUMN IF NOT EXISTS source_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL;

-- Create index for faster lookups of events by source task
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_source_task 
ON public.external_calendar_events(source_task_id) WHERE source_task_id IS NOT NULL;

-- Create index for purpose-based connection lookups
CREATE INDEX IF NOT EXISTS idx_calendar_connections_purposes 
ON public.calendar_connections USING GIN(purposes);

-- Update the insert_calendar_connection_for_user function to accept purposes
CREATE OR REPLACE FUNCTION public.insert_calendar_connection_for_user(
  _user_id uuid, 
  _provider text, 
  _provider_account_id text, 
  _provider_account_email text, 
  _access_token text, 
  _refresh_token text DEFAULT NULL, 
  _scope text DEFAULT NULL, 
  _expires_at timestamp with time zone DEFAULT NULL,
  _purposes TEXT[] DEFAULT ARRAY['READ', 'WRITE']
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  connection_id uuid;
BEGIN
  INSERT INTO public.calendar_connections (
    user_id,
    provider,
    provider_account_id,
    provider_account_email,
    access_token,
    refresh_token,
    scope,
    expires_at,
    purposes
  ) VALUES (
    _user_id,
    _provider,
    _provider_account_id,
    _provider_account_email,
    public.encrypt_token(_access_token, _user_id),
    CASE 
      WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token, _user_id)
      ELSE NULL
    END,
    _scope,
    _expires_at,
    _purposes
  ) RETURNING id INTO connection_id;
  
  PERFORM public.log_oauth_token_access(connection_id, 'created');
  
  RETURN connection_id;
END;
$function$;

-- Create function to update connection purposes
CREATE OR REPLACE FUNCTION public.update_calendar_connection_purposes(
  _connection_id uuid,
  _purposes TEXT[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.calendar_connections 
  SET 
    purposes = _purposes,
    updated_at = now()
  WHERE id = _connection_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$function$;

-- Create function to update sync token for delta sync
CREATE OR REPLACE FUNCTION public.update_calendar_sync_token(
  _connection_id uuid,
  _sync_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.calendar_connections 
  SET 
    sync_token = _sync_token,
    updated_at = now()
  WHERE id = _connection_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$function$;

-- Drop existing functions before recreating with new return types
DROP FUNCTION IF EXISTS public.get_calendar_connections_safe();
DROP FUNCTION IF EXISTS public.get_calendar_connections_secure();

-- Update get_calendar_connections_safe to include purposes and sync_token
CREATE FUNCTION public.get_calendar_connections_safe()
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
  updated_at timestamp with time zone,
  purposes TEXT[],
  sync_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
  SELECT auth.uid(), cc.id, 'safe_view_access'
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid()
  LIMIT 1;
  
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
    cc.updated_at,
    cc.purposes,
    cc.sync_token
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
END;
$function$;

-- Also update the secure version to include purposes
CREATE FUNCTION public.get_calendar_connections_secure()
RETURNS TABLE(
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
  refresh_token text,
  purposes TEXT[],
  sync_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.log_oauth_token_access(cc.id, 'accessed')
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
  
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
    public.decrypt_token(cc.access_token, cc.user_id) as access_token,
    CASE 
      WHEN cc.refresh_token IS NOT NULL THEN public.decrypt_token(cc.refresh_token, cc.user_id)
      ELSE NULL
    END as refresh_token,
    cc.purposes,
    cc.sync_token
  FROM public.calendar_connections cc
  WHERE cc.user_id = auth.uid();
END;
$function$;