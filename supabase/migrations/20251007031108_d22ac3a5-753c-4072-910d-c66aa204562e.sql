-- Remove foreign key constraint that blocks demo user
-- Demo users don't exist in auth.users, so we need to allow user_id values
-- that aren't in auth.users for demo mode to work

ALTER TABLE public.user_scheduling_prefs 
DROP CONSTRAINT IF EXISTS user_scheduling_prefs_user_id_fkey;

-- Add unique constraint to ensure one preference set per user
ALTER TABLE public.user_scheduling_prefs 
ADD CONSTRAINT user_scheduling_prefs_user_id_unique UNIQUE (user_id);