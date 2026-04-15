ALTER TABLE public.notification_prefs
ADD COLUMN IF NOT EXISTS schedule_confirmed_date text DEFAULT '';