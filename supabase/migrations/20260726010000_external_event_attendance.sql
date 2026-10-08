-- External-meeting confirmation + slot release.
-- External calendar events (meetings) act as busy holds the scheduler works around, but
-- the user may not actually attend. This table records a confirmation ("are you doing
-- this?") per meeting. On decline / no-show the freed window is released to the next
-- same-category task (handled by the confirm-external-meeting edge function).
--
-- Keyed by the STABLE external_event_id (not external_calendar_events.id) so the record
-- survives calendar delta re-sync, which replaces the event rows.
CREATE TABLE IF NOT EXISTS public.external_event_attendance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  event_title       text,
  event_start       timestamptz,
  event_end         timestamptz,
  category          text NOT NULL DEFAULT 'CAREER',  -- meeting's category for backfill matching
  status            text NOT NULL DEFAULT 'pending', -- 'pending'|'attending'|'declined'|'no_show'
  released          boolean NOT NULL DEFAULT false,  -- freed window handed to a backfill task
  backfill_task_id  uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS external_event_attendance_user_status_idx
  ON public.external_event_attendance (user_id, status, event_start);

ALTER TABLE public.external_event_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own attendance" ON public.external_event_attendance;
CREATE POLICY "Users read own attendance"
  ON public.external_event_attendance FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users upsert own attendance" ON public.external_event_attendance;
CREATE POLICY "Users upsert own attendance"
  ON public.external_event_attendance FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own attendance" ON public.external_event_attendance;
CREATE POLICY "Users update own attendance"
  ON public.external_event_attendance FOR UPDATE
  USING (auth.uid() = user_id);
