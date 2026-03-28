

# Fix: Tasks Missing from All Tabs (View-Based Approach)

## Problem

After nightly rollover clears `start_time`, tasks vanish from Agenda, Focus View's "Today's Schedule", DailyScheduleView, and Assignments — not just the Agenda tab. The root cause is every component filters on `start_time` existing, and once cleared, tasks disappear from all views including past days.

## Solution: Database View + Frontend Updates

### Step 1: Create `tasks_with_schedule` Database View

```sql
CREATE OR REPLACE VIEW public