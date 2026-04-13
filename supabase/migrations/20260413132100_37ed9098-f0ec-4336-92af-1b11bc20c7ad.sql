ALTER TABLE public.notification_prefs 
ADD COLUMN IF NOT EXISTS calendar_reminders_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS calendar_reminder_minutes integer NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS calendar_reminder_channels text[] NOT NULL DEFAULT '{PUSH}'::text[];