-- Add is_recurring flag to external_calendar_events
ALTER TABLE external_calendar_events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;

-- Clear untitled events from von connection and reset sync token for clean re-sync
DELETE FROM external_calendar_events
WHERE connection_id = 'bb04653a-9fa9-4b23-8ab4-00a85b07665b'
  AND title = 'Untitled Event';

UPDATE calendar_connections
SET sync_token = NULL
WHERE id = 'bb04653a-9fa9-4b23-8ab4-00a85b07665b';