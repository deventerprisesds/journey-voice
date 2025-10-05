-- Add scheduling_context column to tasks table
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS scheduling_context JSONB;

COMMENT ON COLUMN public.tasks.scheduling_context IS 
'Stores AI-generated scheduling preferences like business_hours, weekdays_only, morning_preferred, etc.';