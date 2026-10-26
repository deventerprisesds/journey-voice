-- RECORDED ON MAIN 2026-10-26 (restore step 2). Applied live as version 20260826022400 with NO file on
-- any branch. The SQL below is copied verbatim from supabase_migrations.schema_migrations.statements for
-- that version (read-only SELECT), and the live columns, FK, comments and index were confirmed present.
-- ============================================================================
-- TOPIC INDEX — dedup + lifecycle
--
-- Problem (measured 2026-08-25): 119 auto-generated topics for one user, many
-- near-duplicates of the same real thread ("Career Development" / "Career
-- Development Tasks" / "Career Coaching" / "Career Review Management" ...), plus
-- dozens of single-task topics and large topics with zero remaining open tasks.
--
-- Root cause: classify-task-topic asks the model to reuse an existing topic, but
-- when the model answers action="existing" with a name that does not EXACTLY
-- (case-insensitively) match a stored topic_name, the code falls through and
-- creates a NEW topic instead. Combined with sending all 119 topics into every
-- prompt at temperature 0.3, drift is guaranteed and compounding.
--
-- This migration adds lifecycle columns so cleanup is reversible and so the
-- classifier can be scoped to live topics only:
--   archived_at  — soft archive. Archived topics stay for history but are hidden
--                  from the classifier prompt so they stop attracting new tasks.
--   merged_into  — when a duplicate is folded into a canonical topic, this records
--                  where it went (audit trail; the row is kept, not deleted).
-- ============================================================================

ALTER TABLE public.task_topic_index
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.task_topic_index(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.task_topic_index.archived_at IS
  'Soft archive: kept for history, excluded from the classifier prompt so it stops attracting new tasks.';
COMMENT ON COLUMN public.task_topic_index.merged_into IS
  'Set when this topic was folded into a canonical topic during dedup. Row retained as an audit trail.';

CREATE INDEX IF NOT EXISTS idx_task_topic_index_live
  ON public.task_topic_index(user_id) WHERE archived_at IS NULL AND merged_into IS NULL;
