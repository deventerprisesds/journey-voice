-- Add 5 window-transition calls to dev@enterpriseds.io account
-- This appends to existing scheduled_calls array, preserving current 7 calls

UPDATE public.user_scheduling_prefs
SET scheduled_calls = scheduled_calls || '[
  {
    "id": "window_morning",
    "name": "Morning Kickstart",
    "time": "06:00",
    "enabled": true,
    "context": "[WINDOW:morning] Branch 1: Review tasks due in morning window (6AM-9AM), provide day overview. Branch 2: Topic Jog - suggest planning or morning routines.",
    "commsMode": "chat"
  },
  {
    "id": "window_business",
    "name": "Business Hours Start",
    "time": "09:00",
    "enabled": true,
    "context": "[WINDOW:business_hours] Branch 1: Review tasks due in business hours window (9AM-5PM). Branch 2: Topic Jog - suggest work-related focus areas.",
    "commsMode": "chat"
  },
  {
    "id": "window_after_work",
    "name": "Daily Wrap-up",
    "time": "17:00",
    "enabled": true,
    "context": "[WINDOW:after_work] Branch 1: Review tasks due in after-work window (5PM-7PM), summarize day progress. Branch 2: Topic Jog - suggest reflection or planning.",
    "commsMode": "chat"
  },
  {
    "id": "window_evening",
    "name": "Evening Start",
    "time": "19:00",
    "enabled": true,
    "context": "[WINDOW:evening] Branch 1: Review tasks due in evening window (7PM-10PM). Branch 2: Topic Jog - suggest personal projects or relaxation.",
    "commsMode": "chat"
  },
  {
    "id": "window_weekends",
    "name": "Weekend Morning",
    "time": "10:00",
    "enabled": true,
    "context": "[WINDOW:weekends] Branch 1: Review weekend tasks and personal projects. Branch 2: Topic Jog - suggest hobbies or family activities.",
    "commsMode": "chat"
  }
]'::jsonb,
updated_at = now()
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';