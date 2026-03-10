-- Rename old 7-parameter schedule_next_call to resolve PostgREST ambiguity
-- The new 8-parameter version (with p_days_of_week) was created in a previous migration
ALTER FUNCTION public.schedule_next_call(uuid, text, text, time without time zone, text, text, text)
RENAME TO schedule_next_call_v1_backup;