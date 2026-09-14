-- =============================================================================
-- Task de-duplication audit log.
-- Every time the creation-time dedup guard SKIPS (high-confidence duplicate) or
-- FLAGS (ambiguous "possible-duplicate") a task, it records a row here capturing the
-- FULL would-be task payload so the action is fully UNDOABLE and reviewable.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.task_dedup_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  board_id       uuid,
  action         text NOT NULL CHECK (action IN ('skipped', 'flagged')),
  candidate      jsonb NOT NULL,         -- complete would-be task payload (undo source)
  matched_task_id uuid,                  -- existing task it matched (null = matched an in-batch sibling)
  matched_title  text,
  method         text CHECK (method IN ('signature', 'semantic')),
  similarity     numeric,               -- cosine, for semantic matches
  source         text,                  -- creation path: parse_and_create_tasks | create_task | mcp | voice
  created_task_id uuid,                 -- for 'flagged': the task that WAS created (so undo can untag/remove)
  undone_at      timestamptz,           -- set when the user undoes this dedup
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_dedup_log_user_created
  ON public.task_dedup_log (user_id, created_at DESC);

ALTER TABLE public.task_dedup_log ENABLE ROW LEVEL SECURITY;

-- Owner can read and update (for undo) their own dedup log; writes happen via the
-- service role inside edge functions, which bypasses RLS.
DROP POLICY IF EXISTS "own dedup log select" ON public.task_dedup_log;
CREATE POLICY "own dedup log select" ON public.task_dedup_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own dedup log update" ON public.task_dedup_log;
CREATE POLICY "own dedup log update" ON public.task_dedup_log
  FOR UPDATE USING (auth.uid() = user_id);
