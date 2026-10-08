-- ============================================================================
-- SHADOW RUN ARCHIVE
-- Durable storage for shadow-run diagnostics (scripts/shadow-run/).
--
-- A shadow run clones a user's scheduling world onto a synthetic user, runs the
-- REAL nightly-schedule-builder against it (no dryRun), then tears the shadow
-- user down. Teardown deletes the shadow tasks and its activity_log rows — which
-- is where the slotter_trace diagnostics live. These tables are keyed by run and
-- are NEVER torn down, so the "why was this task dropped" evidence and the
-- produced schedule both survive for later comparison (incl. composite vs
-- priority-rank A/B).
--
-- Exists because a teardown on 2026-08-20 destroyed the slotter_trace rows before
-- the rejection detail had been reviewed: the counts survived, the itemized
-- reasons did not. Printing before deleting was not enough — if the output isn't
-- captured it's still lost, so the data is COPIED into these tables instead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shadow_runs (
  run_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL UNIQUE,
  shadow_user     uuid NOT NULL,
  source_user     uuid NOT NULL,
  scoring_model   text,
  code_ref        text,             -- git sha / branch under test
  notes           text,
  total_scheduled int,
  tasks_cloned    int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per slotter invocation: what it was handed, what the AI proposed,
-- what was accepted, and every rejection reason.
CREATE TABLE IF NOT EXISTS public.shadow_run_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES public.shadow_runs(run_id) ON DELETE CASCADE,
  target_date   text,
  called_at     timestamptz,
  tasks_in      jsonb,
  ai_proposed   jsonb,
  accepted      jsonb,
  rejected      jsonb,
  busy_in       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Snapshot of the schedule the run actually produced (shadow tasks get deleted).
CREATE TABLE IF NOT EXISTS public.shadow_run_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.shadow_runs(run_id) ON DELETE CASCADE,
  title           text,
  category        text,
  priority        text,
  status          text,
  start_time      timestamptz,
  end_time        timestamptz,
  due_date        timestamptz,
  is_priority     boolean,
  is_scheduled    boolean,
  task_created_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_run_traces_run_idx     ON public.shadow_run_traces(run_id);
CREATE INDEX IF NOT EXISTS shadow_run_schedule_run_idx   ON public.shadow_run_schedule(run_id);
CREATE INDEX IF NOT EXISTS shadow_run_schedule_start_idx ON public.shadow_run_schedule(run_id, start_time);
