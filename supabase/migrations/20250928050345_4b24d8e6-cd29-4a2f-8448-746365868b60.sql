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
  
  -- Log the creation in audit table
  INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
  VALUES (auth.uid(), connection_id, 'created');
  
  RETURN connection_id;
END;
$$;

-- Create function to safely get decrypted tokens (with audit logging)
CREATE OR REPLACE FUNCTION public.get_calendar_connection_tokens(_connection_id uuid)
RETURNS TABLE(access_token text, refresh_token text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the access
  INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
  VALUES (auth.uid(), _connection_id, 'accessed');
  
  -- Return decrypted tokens only for the owner
  RETURN QUERY
  SELECT 
    public.decrypt_token(cc.access_token) as access_token,
    CASE 
      WHEN cc.refresh_token IS NOT NULL THEN public.decrypt_token(cc.refresh_token)
      ELSE NULL
    END as refresh_token,
    cc.expires_at
  FROM public.calendar_connections cc
  WHERE cc.id = _connection_id AND cc.user_id = auth.uid();
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
    INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
    VALUES (auth.uid(), _connection_id, 'refreshed');
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
  INSERT INTO public.oauth_token_audit (user_id, connection_id, action_type)
  VALUES (auth.uid(), _connection_id, 'revoked');
  
  -- Delete the connection (only if user owns it)
  DELETE FROM public.calendar_connections 
  WHERE id = _connection_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$;