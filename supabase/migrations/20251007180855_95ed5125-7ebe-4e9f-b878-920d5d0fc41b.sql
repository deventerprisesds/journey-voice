-- Step 1: Drop all foreign keys that reference auth.users
ALTER TABLE public.sync_config DROP CONSTRAINT IF EXISTS sync_config_user_id_fkey;
ALTER TABLE public.sync_logs DROP CONSTRAINT IF EXISTS sync_logs_user_id_fkey;
ALTER TABLE public.public_profiles DROP CONSTRAINT IF EXISTS public_profiles_user_id_fkey;

-- Step 2: Insert demo user into profiles (this will trigger sync to public_profiles)
INSERT INTO public.profiles (user_id, full_name, email, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Demo User',
  'demo@example.com',
  now(),
  now()
)
ON CONFLICT (user_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  updated_at = now();

-- Step 3: Ensure demo user exists in public_profiles (in case trigger failed)
INSERT INTO public.public_profiles (id, user_id, full_name, created_at)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Demo User',
  now()
)
ON CONFLICT (user_id) DO UPDATE SET
  full_name = EXCLUDED.full_name;

-- Step 4: Add new foreign key constraints referencing profiles instead of auth.users
ALTER TABLE public.sync_config 
ADD CONSTRAINT sync_config_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.sync_logs 
ADD CONSTRAINT sync_logs_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.public_profiles 
ADD CONSTRAINT public_profiles_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;