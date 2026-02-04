
# Fix: Realtime Messages Not Appearing Without Refresh

## Problem Identified

The `conversation_messages` table is **NOT** added to the Supabase Realtime publication. This means:
- The Realtime subscription code in `CommsConsoleContext.tsx` is correct
- BUT Postgres never broadcasts INSERT events because the table isn't in the `supabase_realtime` publication
- Messages only appear after a manual refresh (when history is re-fetched from DB)

### Evidence

Query result for `pg_publication_tables`:
```text
schemaname | tablename
-----------+---------------------------
public     | lecture_transcripts_segments
public     | session_notes
```

`conversation_messages` is **missing** from this list.

## Solution

### Phase 1: Add Table to Realtime Publication (Database Migration)

Run a migration to add `conversation_messages` to the Realtime publication:

```sql
-- Add conversation_messages to Supabase Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
```

This is a one-line migration that enables Postgres to broadcast INSERT/UPDATE/DELETE events for this table.

### Phase 2: Verify Subscription Works

After the migration:
1. Open the Comms Console in the browser
2. Trigger a test message via the `send-chat-message` edge function
3. Message should appear instantly in the chat WITHOUT a push notification (if user is active)
4. Console logs should show: `[CommsConsole] Realtime message received: <message-id>`

## Why This Wasn't Working Before

- Supabase Realtime requires tables to be explicitly added to the `supabase_realtime` publication
- Without this, Postgres doesn't emit the change events that the Realtime server listens to
- The subscription in the frontend was correctly set up but never received events

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| Migration | CREATE | Add `conversation_messages` to Realtime publication |

## Technical Details

The migration uses `ALTER PUBLICATION` which is the standard Postgres way to add tables to a logical replication publication. Supabase's Realtime server subscribes to this publication and forwards events to connected clients via WebSocket.
