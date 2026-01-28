

# Fix Call Connection and Transcription Persistence

## Problem Identified

Your scheduled call at 00:00 UTC failed to connect because of a **database schema mismatch**. The `pre_connect_sessions` table is missing 5 columns that the code expects:

| Column | Purpose |
|--------|---------|
| `openai_voice` | User's selected OpenAI voice for fallback |
| `phone_call_mode` | Call mode (media_streams vs direct) |
| `rag_context` | Pre-cached RAG context to skip queries during call |
| `instructions` | Pre-generated system instructions |
| `thread_id` | Pre-resolved thread ID for conversation continuity |

When the pre-connect step fails, the entire call fails before any audio can be exchanged - that's why there's no transcript.

---

## Solution: Add Missing Columns

### Database Migration

Add the 5 missing columns to `pre_connect_sessions`:

```sql
-- Add missing columns for enhanced pre-connect caching
ALTER TABLE pre_connect_sessions 
  ADD COLUMN IF NOT EXISTS openai_voice TEXT,
  ADD COLUMN IF NOT EXISTS phone_call_mode TEXT DEFAULT 'media_streams',
  ADD COLUMN IF NOT EXISTS rag_context TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS thread_id UUID;

-- Index on thread_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_pre_connect_thread 
  ON pre_connect_sessions(thread_id);
```

---

## Why This Works

Once the columns exist:

1. **Pre-connect succeeds** - Session data stores correctly
2. **Call connects** - Twilio media stream establishes
3. **Audio flows** - User speech reaches OpenAI
4. **Transcripts save** - `call_messages` and `conversation_messages` get populated

The transcription logic itself is working (as evidenced by your 17:30 call having messages). The failure happens earlier in the pipeline.

---

## Implementation Steps

| Step | Action |
|------|--------|
| 1 | Create database migration to add 5 missing columns |
| 2 | Wait for migration to apply |
| 3 | Test next scheduled call - should connect and save transcripts |

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/[new].sql` | Add missing columns to `pre_connect_sessions` |

No edge function changes needed - the code is already correct, it's just the database that's behind.

