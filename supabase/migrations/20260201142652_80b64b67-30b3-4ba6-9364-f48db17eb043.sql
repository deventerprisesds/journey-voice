-- Add preferred_greeting column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS preferred_greeting TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.preferred_greeting IS 
'How the user prefers to be addressed (e.g., "Sir", "Von", "Mr. Chase"). If set, overrides first_name for greetings.';