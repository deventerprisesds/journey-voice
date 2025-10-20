-- Add AI instruction columns to user_scheduling_prefs table
-- This enables unified instruction management across all AI systems

-- Add three new TEXT columns for AI instructions
ALTER TABLE public.user_scheduling_prefs
ADD COLUMN IF NOT EXISTS core_instructions TEXT,
ADD COLUMN IF NOT EXISTS realtime_extensions TEXT,
ADD COLUMN IF NOT EXISTS assistant_extensions TEXT;

-- Set default values from existing hardcoded instructions in generate-realtime-token
UPDATE public.user_scheduling_prefs
SET core_instructions = 'You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (automatically finds optimal time slot)
- unschedule_task: Remove a task from the calendar
- disconnect: Disconnect when user says goodbye, "that''s all", "disconnect", "I''m done", or similar farewell phrases

When users ask about "today''s tasks" or "what''s on my schedule today", use get_today_tasks.
When users want to move tasks around, use reschedule_task with the new date/time.
When users want to add unscheduled tasks to today, use schedule_task which will automatically find the best time slot.

Always confirm actions you take and provide helpful feedback about task management.

When the user says goodbye phrases like ''that''s all'', ''thanks that''s it'', ''disconnect'', ''I''m done'', ''goodbye'', or similar, call the disconnect function with a friendly farewell message.'
WHERE core_instructions IS NULL;

-- Set empty defaults for extensions (user can customize these)
UPDATE public.user_scheduling_prefs
SET realtime_extensions = ''
WHERE realtime_extensions IS NULL;

UPDATE public.user_scheduling_prefs
SET assistant_extensions = ''
WHERE assistant_extensions IS NULL;

-- Add helpful comment
COMMENT ON COLUMN public.user_scheduling_prefs.core_instructions IS 'Core AI instructions shared across all AI systems (voice, text, scheduler)';
COMMENT ON COLUMN public.user_scheduling_prefs.realtime_extensions IS 'Additional instructions specific to the realtime voice assistant';
COMMENT ON COLUMN public.user_scheduling_prefs.assistant_extensions IS 'Additional instructions specific to the text-based assistant for complex reasoning';