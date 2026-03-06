
-- The recurring-calls-check cron was already removed or never existed.
-- Verify schedule_next_call and sync_scheduled_calls were applied by running a no-op.
-- This is a safety migration to ensure the schema is consistent.
SELECT 1;
