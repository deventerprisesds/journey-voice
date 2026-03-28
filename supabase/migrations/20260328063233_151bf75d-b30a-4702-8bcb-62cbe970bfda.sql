CREATE TABLE public.task_schedule_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  action TEXT NOT NULL DEFAULT 'rollover',
  pushed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.task_schedule_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task schedule history"
  ON public.task_schedule_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_task_schedule_history_user_date ON public.task_schedule_history(user_id, scheduled_date);
CREATE INDEX idx_task_schedule_history_task ON public.task_schedule_history(task_id);