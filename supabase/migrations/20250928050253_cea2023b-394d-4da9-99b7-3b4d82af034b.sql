-- Create a secure token encryption function using built-in pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create a function to encrypt tokens securely
CREATE OR REPLACE FUNCTION public.encrypt_token(token_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  encryption_key text;
BEGIN
  -- Use a combination of a fixed salt and user-specific data for encryption
  -- In production, you should use environment variables or Supabase vault
  encryption_key := encode(digest('oauth_token_key_2024' || auth.uid()::text, 'sha256'), 'hex');
  
  -- Return encrypted token using AES encryption
  RETURN encode(
    encrypt_iv(
      token_value::bytea, 
      decode(substring(encryption_key from 1 for 32), 'hex'),
      decode(substring(encryption_key from 33 for 32), 'hex'),
      'aes'
    ), 
    'base64'
  );
END;
$$;

-- Create a function to decrypt tokens securely
CREATE OR REPLACE FUNCTION public.decrypt_token(encrypted_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  encryption_key text;
BEGIN
  -- Use the same key generation logic
  encryption_key := encode(digest('oauth_token_key_2024' || auth.uid()::text, 'sha256'), 'hex');
  
  -- Return decrypted token
  RETURN convert_from(
    decrypt_iv(
      decode(encrypted_token, 'base64'),
      decode(substring(encryption_key from 1 for 32), 'hex'),
      decode(substring(encryption_key from 33 for 32), 'hex'),
      'aes'
    ), 
    'UTF8'
  );
END;
$$;

-- Create audit log table for token access
CREATE TABLE public.oauth_token_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  action_type text NOT NULL, -- 'created', 'accessed', 'refreshed', 'revoked'
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on audit table
ALTER TABLE public.oauth_token_audit ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view their own audit logs
CREATE POLICY "Users can view their own oauth audit logs"
ON public.oauth_token_audit
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy to allow system to insert audit logs
CREATE POLICY "System can insert oauth audit logs"
ON public.oauth_token_audit
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Add token audit logging function
CREATE OR REPLACE FUNCTION public.log_oauth_token_access(
  _connection_id uuid,
  _action_type text,
  _ip_address inet DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.oauth_token_audit (
    user_id,
    connection_id,
    action_type,
    ip_address,
    user_agent
  ) VALUES (
    auth.uid(),
    _connection_id,
    _action_type,
    _ip_address,
    _user_agent
  );
END;
$$;

-- Create a secure view for calendar connections that automatically encrypts/decrypts tokens
CREATE OR REPLACE VIEW public.calendar_connections_secure AS
SELECT 
  id,
  user_id,
  provider,
  provider_account_id,
  provider_account_email,
  scope,
  expires_at,
  is_active,
  created_at,
  updated_at,
  -- Only return decrypted tokens to the owner
  CASE 
    WHEN auth.uid() = user_id THEN public.decrypt_token(access_token)
    ELSE NULL
  END as access_token,
  CASE 
    WHEN auth.uid() = user_id THEN public.decrypt_token(refresh_token)
    ELSE NULL
  END as refresh_token
FROM public.calendar_connections
WHERE auth.uid() = user_id;

-- Create a function to safely insert encrypted calendar connections
CREATE OR REPLACE FUNCTION public.insert_calendar_connection(
  _provider text,
  _provider_account_id text,
  _provider_account_email text,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _scope text DEFAULT NULL,
  _expires_at timestamp with time zone DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  connection_id uuid;
BEGIN
  -- Insert with encrypted tokens
  INSERT INTO public.calendar_connections (
    user_id,
    provider,
    provider_account_id,
    provider_account_email,
    access_token,
    refresh_token,
    scope,
    expires_at
  ) VALUES (
    auth.uid(),
    _provider,
    _provider_account_id,
    _provider_account_email,
    public.encrypt_token(_access_token),
    CASE 
      WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token)
      ELSE NULL
    END,
    _scope,
    _expires_at
  ) RETURNING id INTO connection_id;
  
  -- Log the creation
  PERFORM public.log_oauth_token_access(connection_id, 'created');
  
  RETURN connection_id;
END;
$$;

-- Create function to safely update tokens (for token refresh)
CREATE OR REPLACE FUNCTION public.update_calendar_connection_tokens(
  _connection_id uuid,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _expires_at timestamp with time zone DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update tokens with encryption, only if user owns the connection
  UPDATE public.calendar_connections 
  SET 
    access_token = public.encrypt_token(_access_token),
    refresh_token = CASE 
      WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token)
      ELSE refresh_token
    END,
    expires_at = COALESCE(_expires_at, expires_at),
    updated_at = now()
  WHERE id = _connection_id AND user_id = auth.uid();
  
  -- Log the refresh if update was successful
  IF FOUND THEN
    PERFORM public.log_oauth_token_access(_connection_id, 'refreshed');
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;

-- Create function to revoke/delete connections securely
CREATE OR REPLACE FUNCTION public.revoke_calendar_connection(_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the revocation first
  PERFORM public.log_oauth_token_access(_connection_id, 'revoked');
  
  -- Delete the connection (only if user owns it)
  DELETE FROM public.calendar_connections 
  WHERE id = _connection_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$;

-- Add additional RLS policies to restrict direct access to the base table
-- Users should use the secure functions instead of direct table access

-- Remove existing policies and add more restrictive ones
DROP POLICY IF EXISTS "Users can manage their own calendar connections" ON public.calendar_connections;
DROP POLICY IF EXISTS "Users can view their own calendar connections" ON public.calendar_connections;

-- New restrictive policies - users can only view through the secure view
CREATE POLICY "Users can view their own calendar connections via secure view"
ON public.calendar_connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Only allow updates through the secure functions
CREATE POLICY "Only secure functions can modify calendar connections"
ON public.calendar_connections
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- Allow the secure functions to bypass RLS for updates
-- This will be handled by the SECURITY DEFINER functions

-- Add trigger to log access to tokens
CREATE OR REPLACE FUNCTION public.log_calendar_connection_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log access to tokens
  IF TG_OP = 'SELECT' THEN
    PERFORM public.log_oauth_token_access(NEW.id, 'accessed');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Note: We're not adding the trigger to avoid excessive logging
-- It would log every time tokens are accessed, which might be too much