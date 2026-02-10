

# Fix: Empty Topic Index Causing Bad Call Experience

## Problem Chain

1. The `task_topic_index` table is **completely empty** (0 rows despite 173 tasks)
2. The database trigger `notify_task_topic_classification` relies on `current_setting('app.settings.supabase_url')` and `current_setting('app.settings.service_role_key')` -- both return NULL in Lovable Cloud
3. So the trigger silently skips every time a task is created/updated, and `classify-task-topic` has **never been called**
4. When a scheduled call hits Branch 2 (no tasks for the window), it tries Topic Jog, finds zero topics, and falls into the "No Tasks or Topics" path which says "Would you like me to help you plan something?" / "Goodbye"
5. The AI interprets this short script too literally and rushes to end the call

## Fix (Two Parts)

### Part 1: Fix the Database Trigger

Replace the `current_setting()` approach with hardcoded Supabase URL + use of `SUPABASE_URL` from the vault/environment. The simplest reliable approach: use `net.http_post` with the project's actual Supabase URL directly, and pass the `apikey` header instead of `service_role_key` (since the edge function already uses service role internally via `SUPABASE_SERVICE_ROLE_KEY` env var).

Recreate the trigger function to use the project's Supabase URL directly (fetched from `supabase_url()` built-in function if available, or hardcoded) and pass the anon key via `apikey` header. The `classify-task-topic` function already authenticates with the service role key from its own environment.

### Part 2: Backfill Existing Tasks

After fixing the trigger, run a one-time backfill by calling `classify-task-topic` for all 108 active tasks. This will be done by creating a small edge function call or SQL script that iterates existing tasks and calls the classification endpoint.

### Part 3: Improve Branch 2 "No Topics" Fallback

Even when the topic index is empty, the call should not feel rushed. Update the "No Tasks or Topics" agenda in `twilio-scheduled-call` to be more conversational -- ask about the user's day, what they have coming up, rather than immediately offering to hang up.

## Technical Details

### File: `supabase/functions/twilio-scheduled-call/index.ts`

Update `buildBranch2Context` for the "no topics" case (lines 296-305) to be more conversational:

```
Instead of:
  "Would you like me to help you plan something?"
  If no: "Goodbye."

Change to:
  "Your schedule is open for the [window] window. 
   What are you thinking about working on? 
   I can help you get something scheduled."
  [Continue conversation naturally, do NOT rush to hang up]
```

### Database Migration (new SQL migration)

```sql
CREATE OR REPLACE FUNCTION public.notify_task_topic_classification()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.title ILIKE '%test%' OR NEW.status = 'BLOCKED' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/classify-task-topic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<anon-key>'
    ),
    body := jsonb_build_object(
      'task_id', NEW.id,
      'task_title', NEW.title,
      'task_category', NEW.category,
      'user_id', NEW.user_id,
      'operation', TG_OP
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Topic classification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

The actual URL and anon key will be read from the Supabase client config already in the codebase.

### Backfill Script

After the trigger is fixed and `classify-task-topic` is deployed, invoke the function for each active task to populate the topic index. This can be done via a temporary edge function or by triggering a no-op UPDATE on all tasks (e.g., `UPDATE tasks SET updated_at = now() WHERE status NOT IN ('DONE','BLOCKED') AND title NOT ILIKE '%test%'`), which will fire the trigger for each row.

## Files to Modify

| File | Change |
|------|--------|
| New SQL migration | Fix trigger to use direct URL instead of `current_setting()` |
| `supabase/functions/twilio-scheduled-call/index.ts` | Improve "No Topics" fallback to be conversational |
| `supabase/functions/classify-task-topic/index.ts` | Ensure it accepts anon key auth (add service role client internally) |
| Backfill | Run `UPDATE tasks SET updated_at = now()` to trigger classification for all existing tasks |

## Expected Outcome

- Topic index gets populated with semantic groupings from 108 active tasks
- Future task creates/updates automatically classify into topics
- Scheduled calls hitting Branch 2 will have topics to jog memory with
- Even when no topics exist, the call won't rush to hang up

