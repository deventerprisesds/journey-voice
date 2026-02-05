
# Add Window-Transition Calls to Demo Mode Settings

## Overview
The demo user's `user_scheduling_prefs` currently only has the original 3 recurring calls plus a custom test call. I need to update the `scheduled_calls` JSONB column to include the 5 new window-transition calls so you can test them.

## Current State
The demo user (`00000000-0000-0000-0000-000000000001`) has these calls:
- Morning Stand-up (11:00) - disabled
- Midday Check-in (12:30) - disabled  
- End of Day Wrap-up (19:00) - disabled
- Test recurring call (14:11) - enabled

## What I'll Add
5 new window-transition calls (matching `DEFAULT_SCHEDULED_CALLS` in VoiceAssistantSettings.tsx):
- Morning Kickstart (06:00) - `[WINDOW:morning]` - enabled for testing
- Business Hours Start (09:00) - `[WINDOW:business_hours]` - enabled for testing
- Daily Wrap-up (17:00) - `[WINDOW:after_work]` - enabled for testing
- Evening Start (19:00) - `[WINDOW:evening]` - enabled for testing
- Weekend Morning (10:00) - `[WINDOW:weekends]` - enabled for testing

## Implementation
Create a migration that updates the demo user's `scheduled_calls` column to include all 8 calls (3 original + 5 window transitions), with the window transitions **enabled** so you can test them immediately.

## Files to Create
| File | Purpose |
|------|---------|
| `supabase/migrations/xxx_demo_window_calls.sql` | Update demo user's scheduled_calls |

## Testing After
1. Go to Settings page in demo mode
2. Verify 8 scheduled calls appear in the list
3. Window-transition calls should show as enabled
4. Test triggering one via the appropriate commsMode
