-- Value-aware overflow queue.
-- When the nightly builder can't fit a task (window full or the daily working-hours cap
-- is reached), ORDINARY tasks quietly roll to the next day (unchanged). A HIGH-IMPACT
-- task (financial / communication / time-sensitive / pinned / user-priority) instead
-- lands here so the morning-review agent can surface it and offer to BUMP a lower-value
-- item to make room. This is a nudge surface, not a second scheduler.
CREATE TABLE IF NOT EXISTS public.task_overflow_queue (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id                uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  overflow_date          date NOT NULL,          -- the day it couldn't fit
  reason                 text NOT NULL,          -- 'no_window_capacity' | 'daily_hours_cap'
  score                  numeric,                -- scorer's value at overflow time
  impact_factors         text[] NOT NULL DEFAULT '{}',  -- ['financial','due_soon',...]
  duration_minutes       integer,
  suggested_bump_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  suggested_bump_title   text,
  message                text NOT NULL,          -- human-readable nudge for the agent/user
  status                 text NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  -- One open row per (task, day) — the builder upserts idempotently each run.
  UNIQUE (task_id, overflow_date)
);

CREATE INDEX IF NOT EXISTS task_overflow_queue_user_open_idx
  ON public.task_overflow_queue (user_id, status, overflow_date);

ALTER TABLE public.task_overflow_queue ENABLE ROW LEVEL SECURITY;

-- Users read/update their own queue (the agent acts as the user via anon/authed client).
CREATE POLICY "Users read own overflow queue"
  ON public.task_overflow_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own overflow queue"
  ON public.task_overflow_queue FOR UPDATE
  USING (auth.uid() = user_id);

-- The nightly builder writes with the service role, which bypasses RLS; no INSERT policy
-- is granted to end users (they never insert overflow rows directly).
