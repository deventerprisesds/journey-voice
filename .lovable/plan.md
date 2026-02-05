
# Add Window-Transition Calls to Your Account

## Problem
The window-transition calls (Morning Kickstart, Business Hours Start, etc.) are defined in `DEFAULT_SCHEDULED_CALLS` but:
- These defaults only apply when **no data exists** in `user_scheduling_prefs`
- Your account already has saved `scheduled_calls` data (7 calls currently)
- So the code loads your existing data and never merges in the new defaults

## Solution
Create a database migration to add the 5 window-transition calls to your existing `scheduled_calls` array while preserving your current calls.

## Current Calls (Your Account)
| Name | Time | Status |
|------|------|--------|
| Morning Stand-up | 09:00 | enabled |
| Midday Check-in | 12:32 | enabled |
| End of Day Wrap-up | 19:00 | enabled |
| Test call | 19:57 | enabled |
| Test call 2 | 22:35 | disabled |
| Test call 3 | 22:48 | disabled |
| Fried Fish Recipe | 20:00 | enabled |

## Calls to Add
| Name | Time | Window Marker | Status |
|------|------|---------------|--------|
| Morning Kickstart | 06:00 | `[WINDOW:morning]` | enabled |
| Business Hours Start | 09:00 | `[WINDOW:business_hours]` | enabled |
| Daily Wrap-up | 17:00 | `[WINDOW:after_work]` | enabled |
| Evening Start | 19:00 | `[WINDOW:evening]` | enabled |
| Weekend Morning | 10:00 | `[WINDOW:weekends]` | enabled |

## Implementation
Create a SQL migration that uses `jsonb_concat` to append the 5 new window calls to your existing `scheduled_calls` array.

## Technical Details

```sql
UPDATE public.user_scheduling_prefs
SET scheduled_calls = scheduled_calls || '[
  {"id": "window_morning", "name": "Morning Kickstart", ...},
  {"id": "window_business", "name": "Business Hours Start", ...},
  ...
]'::jsonb
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
```

## Result
After this migration, you'll see all 12 calls in your Settings page:
- 7 existing calls (preserved)
- 5 new window-transition calls (added)
