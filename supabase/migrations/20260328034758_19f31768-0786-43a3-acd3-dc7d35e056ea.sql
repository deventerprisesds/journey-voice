-- One-time data cleanup: clear stale events and reset sync tokens
DELETE FROM external_calendar_events;
UPDATE calendar_connections SET sync_token = NULL WHERE is_active = true;