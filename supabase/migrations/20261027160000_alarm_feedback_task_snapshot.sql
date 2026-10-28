-- WHAT:       When phone-alarm feedback (thumbs up/down + a note) is logged, freeze a copy of how the
--             task was scheduled at that moment into the same row.
-- WHY:        The owner wants to track over time whether alarmed items were scheduled well and what
--             they would rather see. A rating is only useful next to WHAT was scheduled (slot,
--             priority, category, how often it was pushed) — and the task row keeps changing after the
--             alarm, so a join at read time would show today's values, not the ones being judged.
--             Feedback lives in public.activity_log (activity_type = 'alarm_feedback'), next to the
--             android_alarm_action / android_alarm_trace rows the alarm already writes, rather than in
--             a new table. Writers: alarm-action op "feedback" (signed action token, no login) and the
--             phone's logged-in fallback (direct insert, RLS "Users can insert their own activity").
--             One trigger covers both, so the snapshot cannot drift between them.
-- SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   android-bridge-template alarm feedback panel (AlarmConfirmActivity); alarm-action op "feedback".
--
-- Safety: BEFORE INSERT, only for alarm_feedback rows, and any error is swallowed so feedback is never
-- lost because the snapshot failed. The task is read only when it belongs to the row's own user_id.

create or replace function public.snapshot_alarm_feedback_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_snap jsonb;
begin
  begin
    if coalesce(new.metadata->>'taskId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_task_id := (new.metadata->>'taskId')::uuid;
      select jsonb_build_object(
               'title', t.title,
               'status', t.status,
               'priority', t.priority,
               'category', t.category,
               'start_time', t.start_time,
               'end_time', t.end_time,
               'due_date', t.due_date,
               'is_scheduled', t.is_scheduled,
               'estimate_minutes', t.estimate_minutes,
               'pushed_count', t.pushed_count,
               'is_priority', t.is_priority,
               'tags', t.tags,
               'scheduling_context', t.scheduling_context,
               'captured_at', now())
        into v_snap
        from public.tasks t
       where t.id = v_task_id
         and t.user_id = new.user_id;
      if v_snap is not null then
        new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('task', v_snap);
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_alarm_feedback_task on public.activity_log;
create trigger trg_snapshot_alarm_feedback_task
  before insert on public.activity_log
  for each row
  when (new.activity_type = 'alarm_feedback')
  execute function public.snapshot_alarm_feedback_task();
