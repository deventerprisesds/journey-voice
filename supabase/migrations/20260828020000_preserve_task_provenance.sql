-- ============================================================================
-- PRESERVE TASK PROVENANCE ACROSS scheduling_context REWRITES
-- ----------------------------------------------------------------------------
-- `public.tasks.scheduling_context` is written by two KINDS of producer that
-- were never reconciled:
--
--   PROVENANCE writers say where the row CAME FROM and are immutable facts:
--     nightly-assignment-sync  -> source ('MIT'|'EMBA'), origin ('nexus-azure'),
--                                 course_id, due_date_inferred
--     confirm-external-meeting -> backfilled_from_meeting
--
--   SCHEDULER writers use it as a per-run SCRATCHPAD and legitimately replace
--   the whole object every run:
--     nightly-schedule-builder -> pre_schedule_status, venue_nudge,
--                                 reshuffle_retry, assignment_tier,
--                                 archived_reason, original_due_date, pushed_count
--
-- Because every scheduler write REPLACES the jsonb rather than merging it, the
-- provenance keys are destroyed the first time a task is scheduled. This is not
-- theoretical: measured 2026-08-28 on the live board, of 50 tasks with an
-- assignment_id, 11 carried `source`, 36 carried a scheduler key, and **0
-- carried both** — the two sets are mutually exclusive, which is the exact
-- signature of the wipe. The user-visible symptom is the 📚 MIT/EMBA badge in
-- FocusView (`scheduling_context.source`), which is why that component carries a
-- `category === 'EDUCATION' ? 'MIT' : 'EMBA'` GUESS as a fallback.
--
-- WHY A TRIGGER RATHER THAN FIXING THE CALL SITES.
-- The wipe happens in at least three places and would recur in any new one:
-- five update sites in nightly-schedule-builder, one in confirm-external-meeting,
-- and the CLIENT (`FocusView.tsx` sets `scheduling_context: null` on unschedule).
-- An edge-function-side merge cannot cover the client writers at all. One guard
-- at the table covers every writer that exists today and every writer added
-- later, which is the point: this is a structural guarantee, not call-site care.
--
-- SHAPE NOTE — the column legally holds THREE shapes and this must tolerate all:
--   object (240 rows)  the scheduler/provenance form
--   NULL    (58 rows)  never scheduled, or explicitly cleared on unschedule
--   array    (7 rows)  a string[] of `timeWindow:`/`status:`/`suggested_time:`
--                      hints — written by ai-task-parser, read by
--                      smart-calendar-scheduler. Arrays are left ENTIRELY alone.
--
-- ESCAPE HATCH: the writer always wins on a key it actually sets, because the
-- merge is `provenance || NEW`. To genuinely drop a provenance key, write it
-- explicitly as JSON null (e.g. `{"source": null}`) rather than omitting it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.preserve_task_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  provenance jsonb;
BEGIN
  -- Untouched column: nothing to do (the common case for most task updates).
  IF NEW.scheduling_context IS NOT DISTINCT FROM OLD.scheduling_context THEN
    RETURN NEW;
  END IF;

  -- Nothing to carry forward unless the OLD value was an object.
  IF OLD.scheduling_context IS NULL
     OR jsonb_typeof(OLD.scheduling_context) <> 'object' THEN
    RETURN NEW;
  END IF;

  -- Respect a writer that is deliberately switching the column to the array
  -- (string[]) form — that is a different contract, not a provenance drop.
  IF NEW.scheduling_context IS NOT NULL
     AND jsonb_typeof(NEW.scheduling_context) = 'array' THEN
    RETURN NEW;
  END IF;

  SELECT jsonb_object_agg(k, v) INTO provenance
  FROM jsonb_each(OLD.scheduling_context) AS e(k, v)
  WHERE k IN ('source', 'origin', 'course_id', 'due_date_inferred',
              'backfilled_from_meeting');

  -- The row carried no provenance — leave the writer's value exactly as sent.
  IF provenance IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.scheduling_context IS NULL
     OR jsonb_typeof(NEW.scheduling_context) <> 'object' THEN
    -- Unschedule sets the column to NULL. Keep provenance rather than lose it;
    -- the scheduler scratch keys are correctly gone.
    NEW.scheduling_context := provenance;
  ELSE
    -- Writer's keys win on conflict; provenance only fills what it omitted.
    NEW.scheduling_context := provenance || NEW.scheduling_context;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_task_provenance_trigger ON public.tasks;

-- BEFORE, so the AFTER triggers already on this table (huddle-task-sync,
-- topic classification, reminder scheduling) all observe the corrected value.
CREATE TRIGGER preserve_task_provenance_trigger
  BEFORE UPDATE OF scheduling_context ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_task_provenance();

COMMENT ON FUNCTION public.preserve_task_provenance() IS
  'Carries immutable provenance keys (source, origin, course_id, due_date_inferred, backfilled_from_meeting) across scheduling_context rewrites, so the nightly scheduler''s per-run scratchpad no longer destroys where a task came from. Writer keys win; write a key as JSON null to drop it deliberately.';
