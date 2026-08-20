-- ============================================================================
-- SHADOW RUN — smart-calendar-scheduler (advisory engine) support
--
-- journey has TWO scheduling engines:
--   * nightly-schedule-builder + batch-calendar-scheduler — multi-task, WRITES.
--   * smart-calendar-scheduler                            — single-task, ADVISORY.
--     Called by ai-task-parser, taskScheduling.ts, RealtimeVoiceAssistant.
--     Every DB read is .eq('user_id', userId) and it performs ZERO writes, so a
--     shadow run only needs the shadow user's rows to exist — nothing to undo.
--
-- `engine` distinguishes which pipeline a run exercised. Suggestions are archived
-- so advisory output survives teardown alongside the nightly diagnostics.
-- ============================================================================

ALTER TABLE public.shadow_runs
  ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'nightly';

COMMENT ON COLUMN public.shadow_runs.engine IS
  'nightly = nightly-schedule-builder+batch-calendar-scheduler (writes); smart = smart-calendar-scheduler (advisory, no writes)';

CREATE TABLE IF NOT EXISTS public.shadow_run_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.shadow_runs(run_id) ON DELETE CASCADE,
  probe_label     text,
  task_text       text,
  task_category   text,
  task_priority   text,
  target_date     text,
  request         jsonb,
  response        jsonb,
  suggested_start timestamptz,
  suggested_end   timestamptz,
  reasoning       text,
  http_status     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_run_suggestions_run_idx ON public.shadow_run_suggestions(run_id);
