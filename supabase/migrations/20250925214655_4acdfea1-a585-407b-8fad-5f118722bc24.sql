-- Add task_created_enabled notification preference
ALTER TABLE public.notification_prefs 
ADD COLUMN task_created_enabled boolean DEFAULT true;