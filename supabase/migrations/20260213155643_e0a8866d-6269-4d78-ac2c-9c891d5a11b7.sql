-- 1. Fix FK: point to profiles instead of auth.users
ALTER TABLE public.task_topic_index
  DROP CONSTRAINT IF EXISTS task_topic_index_user_id_fkey;

ALTER TABLE public.task_topic_index
  ADD CONSTRAINT task_topic_index_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- 2. Add missing category enum values
ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'PROF_EDUCATION';
ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'PERSONAL';