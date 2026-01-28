
# Fix: Remove Foreign Key Constraint from pre_connect_sessions

## Problem Identified

The `pre_connect_sessions` table has a foreign key constraint (`pre_connect_sessions_user_id_fkey`) that references `auth.users(id)`. This breaks Cloudflare bridge calls because:

1. Pre-connect session is generated with all data (audio, instructions, RAG context)
2. Insert into `pre_connect_sessions` **fails** because demo user ID doesn't exist in `auth.users`
3. Cloudflare worker connects, tries to fetch session, finds nothing
4. Call proceeds with generic/no context - appears "broken"

## Evidence

From logs at 17:46:02:
```
ERROR [PRE-CONNECT] Failed to store session in database: {
  code: "23503",
  details: 'Key (user_id)=(00000000-0000-0000-0000-000000000001) is not present in table "users".',
  message: 'insert or update on table "pre_connect_sessions" violates foreign key constraint...'
}
```

## Solution

Remove the foreign key constraint from `pre_connect_sessions`. This table is:
- Ephemeral (2-minute TTL sessions)
- Only accessed by edge functions with service key
- Not user-facing data that needs referential integrity

## Migration SQL

```sql
-- Drop the foreign key constraint that blocks demo user sessions
ALTER TABLE pre_connect_sessions 
  DROP CONSTRAINT IF EXISTS pre_connect_sessions_user_id_fkey;
```

## Why This Works

- Pre-connect sessions are ephemeral (deleted after use or expire in 2 minutes)
- Only edge functions access this table (using service key, RLS disabled)
- The user_id is still stored for context but doesn't need to be a valid auth user
- Demo mode and real users both work

## Files Changed

None - this is a database-only fix.

## Testing After Fix

1. Trigger a scheduled call or manual call
2. Check edge function logs for: `[PRE-CONNECT] ✅ Session stored in database`
3. Check Cloudflare logs for: `[CF] Pre-connect session found`
4. Verify personalized greeting plays and AI knows call context

