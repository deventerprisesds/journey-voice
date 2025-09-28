-- Security Fix: Protect sensitive personal information in profiles table
-- Remove admin access to view all profiles with sensitive data

-- Drop the existing overly permissive admin policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- Create a secure function for admin to get masked profile data
CREATE OR REPLACE FUNCTION public.get_masked_profiles()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  masked_email text,
  masked_phone text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id,
    p.user_id,
    p.full_name,
    p.avatar_url,
    p.created_at,
    p.updated_at,
    -- Mask sensitive data
    CASE 
      WHEN p.email IS NOT NULL THEN CONCAT(LEFT(p.email, 2), '***@***', RIGHT(SPLIT_PART(p.email, '@', 2), 4))
      ELSE NULL 
    END AS masked_email,
    CASE 
      WHEN p.phone IS NOT NULL THEN CONCAT('***-***-', RIGHT(p.phone, 4))
      ELSE NULL 
    END AS masked_phone
  FROM public.profiles p
  WHERE has_role(auth.uid(), 'admin'::app_role);
$$;

-- Create audit log table for profile access
CREATE TABLE IF NOT EXISTS public.profile_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessed_user_id uuid NOT NULL,
  accessor_user_id uuid NOT NULL REFERENCES auth.users(id),
  access_type text NOT NULL, -- 'view', 'update', 'admin_view'
  timestamp timestamp with time zone DEFAULT now(),
  ip_address inet,
  user_agent text
);

-- Enable RLS on access log
ALTER TABLE public.profile_access_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view the access log
CREATE POLICY "Only admins can view profile access logs"
ON public.profile_access_log
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own access log
CREATE POLICY "Users can view their own profile access log"
ON public.profile_access_log
FOR SELECT
USING (auth.uid() = accessed_user_id);

-- System can insert access logs (edge functions)
CREATE POLICY "System can insert access logs"
ON public.profile_access_log
FOR INSERT
WITH CHECK (true);

-- Create function to log profile access
CREATE OR REPLACE FUNCTION public.log_profile_access(
  _accessed_user_id uuid,
  _access_type text,
  _ip_address inet DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_access_log (
    accessed_user_id,
    accessor_user_id,
    access_type,
    ip_address,
    user_agent
  ) VALUES (
    _accessed_user_id,
    auth.uid(),
    _access_type,
    _ip_address,
    _user_agent
  );
END;
$$;

-- Add a trigger to log when users access their own profiles
CREATE OR REPLACE FUNCTION public.log_profile_view()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if it's not the user accessing their own profile
  IF auth.uid() != NEW.user_id THEN
    PERFORM public.log_profile_access(NEW.user_id, 'admin_view');
  END IF;
  RETURN NEW;
END;
$$;