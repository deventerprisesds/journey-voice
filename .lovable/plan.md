

# Combined Plan: Auto-Fill Scheduling + Priority Rules Update

## What This Solves
Your schedule is empty every morning because the system is pull-based. This plan combines two changes:
1. **Nightly auto-scheduler** that rolls over incomplete tasks and fills the week from your Priorities board
2. **Priority scheduling rules** so time-sensitive, people/comms, and financial tasks get scheduled first

---

## Phase 1: Update `schedulingRules.ts` (immediate)

Update the config file with three additions:

**A. New keywords** in `contextRules.keywords` (~line 135):
- Financial: `payment`, `invoice`, `bill`, `tax`, `budget` → `['business_hours', 'LIFE']`
- Comms: `email`, `follow_up`, `respond`, `reply`, `text` → `['business_hours', 'CAREER']`

**B. New priority tier** in `priorityMappings` (~line 186):
- Add `urgent: 4`

**C. New AI instruction** appended to `customAIInstructions` (~line 192):
```
6. ALWAYS prioritize: (a) tasks with due dates within 48 hours, (b) tasks involving
   people or communications (meetings, calls, emails, follow-ups), and (c) tasks with
   financial impact (payments, invoices, contracts). Schedule these earlier in the day
   and give them preference over same-priority tasks.
```

---

## Phase 2: Database Migration

Add `pushed_count` column to the `tasks` table:
```sql
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS pushed_count integer DEFAULT 0;
```

---

## Phase 3: Nightly Auto-Scheduler Edge Function

New edge function `nightly-schedule-builder` that:

1. **Rolls over incomplete tasks** — finds tasks where `start_time < now()` and status is not DONE, clears their `start_time`/`end_time`, sets `is_scheduled = false`, increments `pushed_count`
2. **Gathers candidates** ordered by: pushed tasks first, then `UP_NEXT`, then `READY`/`TODO` sorted by priority weight and due date
3. **Applies priority boost** — tasks matching comms/financial/deadline-within-48h keywords get sorted to the top
4. **Calls `batch-calendar-scheduler`** internally with candidates for the next 5 weekdays, respecting busy slots from `external_calendar_events`
5. **Logs** a `nightly_schedule_built` entry to `activity_log`

Triggered via `pg_cron` at 11 PM user timezone (reads from `user_scheduling_prefs.timezone`).

---

## Phase 4: Weekly Agenda View (UI)

New `WeeklyAgendaView` component accessible from the ViewSwitcher:

- Mon–Sun columns (stacked cards on mobile since viewport is 411px)
- Tasks grouped by time window (Morning / Business / After Work / Evening) using existing `timeWindowStyles` from FocusView
- Empty slots shown as "Available" with quick-add
- "Pushed ×N" badges on rolled-over tasks
- Drag between days to reschedule (reuses `@hello-pangea/dnd` already installed)

---

## Phase 5: Accountability Integration

- **TaskCard + FocusView**: Show "Pushed ×N" badge when `pushed_count > 0`
- **Iris voice**: During morning standup, mention tasks pushed 3+ times ("You've pushed 'Finish report' 3 times now — want to tackle it today or drop it?")
- **Settings**: Add toggle "Auto-fill my schedule nightly" and "Max tasks per day" slider to SchedulingSettings

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/config/schedulingRules.ts` | Add keywords, `urgent: 4`, updated AI instructions |
| Migration SQL | Add `pushed_count` to tasks |
| `supabase/functions/nightly-schedule-builder/index.ts` | New edge function |
| `supabase/config.toml` | Add function config |
| `src/components/WeeklyAgendaView.tsx` | New component |
| `src/components/ViewSwitcher.tsx` | Add "Week Agenda" option |
| `src/components/TaskCard.tsx` | Pushed badge |
| `src/components/FocusView.tsx` | Pushed badge |
| pg_cron SQL (via insert tool) | Schedule nightly job |

