-- Fix the Security Definer View warning by removing the problematic view
-- The view with auth.uid() causes the security definer warning
DROP VIEW IF EXISTS public.calendar_connections_safe;

-- Instead, we'll rely solely on the secure functions for access
-- No view needed since the functions already provide safe access