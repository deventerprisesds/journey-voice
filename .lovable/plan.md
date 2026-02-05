

# Window-Transition Recurring Calls with Dynamic Subject Groupings

## Overview

This implementation adds 5 time-window-anchored recurring calls that intelligently handle branching based on task availability, with a reactive topic/subject grouping system that maintains semantic task clusters for "memory jogging" when no tasks are scheduled.

## Key Changes from Original Plan

Based on your feedback:
1. **No pause after greeting** - The AI will naturally handle conversation flow
2. **6am Branch 1 modified** - Shows morning tasks PLUS all tasks for the rest of the day
3. **Reactive topic maintenance** - Topics are created/updated/deleted via database trigger on task changes (no constant job)
4. **Add branching to send-chat-message** - Same branching logic applies to app_message mode

## Architecture

```text
+---------------------------+     +---------------------------+
|  DEFAULT_SCHEDULED_CALLS  |     |     task_topic_index      |
|  (5 new window calls,     |---->|  (auto-maintained on      |
|   callType: 'custom')     |     |   task INSERT/UPDATE/     |
+---------------------------+     |   DELETE via trigger)     |
             |                    +---------------------------+
             v                                  |
+---------------------------+                   v
|  twilio-scheduled-call    |     +---------------------------+
|  buildCallContext() with  |<----|  classify-task-topic      |
|  window branching logic   |     |  (AI classification)      |
+---------------------------+     +---------------------------+
             |
             +---> phone: twilio-voice-handler
             +---> app_message: send-chat-message (ALSO gets branching)
             +---> slack/email: send-unified-notification
```

## Phase 1: Database Schema - Topic Index

### New Tables

| Table | Purpose |
|-------|---------|
| `task_topic_index` | Stores semantic topics with window affinity |
| `task_topic_mappings` | Links tasks to topics (many-to-many) |

**SQL Migration:**

```sql
-- Topic definitions (auto-generated from task patterns)
CREATE TABLE task_topic_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  topic_name TEXT NOT NULL,
  topic_summary TEXT,
  window_affinity TEXT[] DEFAULT '{}', -- ['morning', 'business_hours', 'after_work', 'evening', 'weekends']
  example_tasks TEXT[] DEFAULT '{}',
  task_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, topic_name)
);

-- Task-to-topic mappings
CREATE TABLE task_topic_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  topic_id UUID REFERENCES task_topic_index(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, topic_id)
);

-- RLS policies
ALTER TABLE task_topic_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_topic_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own topics" ON task_topic_index
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can view own topic mappings" ON task_topic_mappings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_topic_mappings.task_id AND tasks.user_id = auth.uid())
  );
```

## Phase 2: Reactive Topic Maintenance Trigger

A PostgreSQL trigger that fires on task INSERT/UPDATE/DELETE to classify tasks into topics.

**Exclusion Rules:**
- Skip tasks where `title ILIKE '%test%'`
- Skip tasks with `status = 'BLOCKED'`

**Trigger Function:**

```sql
CREATE OR REPLACE FUNCTION notify_task_topic_classification()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip test tasks and blocked tasks
  IF NEW.title ILIKE '%test%' OR NEW.status = 'BLOCKED' THEN
    RETURN NEW;
  END IF;
  
  -- Use pg_net to call edge function asynchronously
  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/classify-task-topic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'task_id', NEW.id,
      'task_title', NEW.title,
      'task_category', NEW.category,
      'user_id', NEW.user_id,
      'operation', TG_OP
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the task operation if classification fails
  RAISE WARNING 'Topic classification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to tasks table
CREATE TRIGGER task_topic_classification_trigger
  AFTER INSERT OR UPDATE OF title, category, status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_topic_classification();

-- Handle deletions separately
CREATE OR REPLACE FUNCTION cleanup_task_topic_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Decrement count on related topics
  UPDATE task_topic_index
  SET task_count = task_count - 1,
      updated_at = now()
  WHERE id IN (
    SELECT topic_id FROM task_topic_mappings WHERE task_id = OLD.id
  );
  
  -- Delete topics with zero tasks
  DELETE FROM task_topic_index WHERE task_count <= 0;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER task_topic_cleanup_trigger
  AFTER DELETE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_task_topic_on_delete();
```

## Phase 3: Topic Classification Edge Function

**New file: `supabase/functions/classify-task-topic/index.ts`**

This function:
1. Receives task info from the trigger
2. Checks existing topics for the user
3. Uses OpenAI to determine best-fit topic or create new one
4. Maps window affinity based on category
5. Updates `task_topic_index` and `task_topic_mappings`

**Key Logic:**

```typescript
// Map categories to default window affinities
const CATEGORY_WINDOW_MAPPING: Record<string, string[]> = {
  'CAREER': ['business_hours'],
  'PROF_EDUCATION': ['after_work', 'evening', 'weekends'],
  'EDUCATION': ['business_hours', 'after_work'],
  'VENTURES': ['after_work', 'evening', 'weekends'],
  'LIFE': ['morning', 'after_work', 'evening', 'weekends'],
  'PERSONAL': ['morning', 'after_work', 'evening', 'weekends'],
};

// AI prompt to classify task into topic
const prompt = `Given these existing topics for this user:
${existingTopics.map(t => `- ${t.topic_name}: ${t.topic_summary}`).join('\n')}

And this new task: "${taskTitle}" (Category: ${taskCategory})

Should this task:
1. Be added to an existing topic? If so, which one?
2. Create a new topic? If so, what should it be called?

Respond with JSON: { "action": "existing" | "new", "topic_name": "...", "topic_summary": "..." }`;
```

## Phase 4: Window Transition Context Builder

**Modify: `supabase/functions/twilio-scheduled-call/index.ts`**

Add new helper functions for window-based branching:

```typescript
// Window time ranges
const WINDOW_RANGES = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
  weekends: { start: 10, end: 20 }
};

// Get tasks for a specific time window (excluding test and blocked)
async function getTasksForWindow(
  supabase: any, 
  userId: string, 
  window: string,
  timezone: string
): Promise<any[]> {
  // Query tasks that match the window and are not test/blocked
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'BLOCKED')
    .not('title', 'ilike', '%test%')
    .order('start_time', { ascending: true });
  
  // Filter by window affinity based on category
  return data?.filter(task => {
    const category = task.category || 'LIFE';
    const categoryWindows = CATEGORY_WINDOW_MAPPING[category] || ['flexible'];
    return categoryWindows.includes(window) || categoryWindows.includes('flexible');
  }) || [];
}

// Get topics for "memory jog" fallback
async function getTopicsForWindow(
  supabase: any, 
  userId: string, 
  window: string
): Promise<any[]> {
  const { data } = await supabase
    .from('task_topic_index')
    .select('topic_name, topic_summary, example_tasks')
    .eq('user_id', userId)
    .contains('window_affinity', [window])
    .order('task_count', { ascending: false })
    .limit(5);
  
  return data || [];
}
```

**Modified `buildCallContext()` to detect window marker and branch:**

```typescript
async function buildCallContext(call: ScheduledCall, userId: string): Promise<string> {
  // Check for window marker in context
  const windowMatch = call.context?.match(/\[WINDOW:(\w+)\]/);
  
  if (windowMatch) {
    const window = windowMatch[1];
    return buildWindowTransitionContext(call, userId, window);
  }
  
  // Existing switch/case logic unchanged...
}

async function buildWindowTransitionContext(
  call: ScheduledCall, 
  userId: string, 
  window: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get user timezone
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  const timezone = prefs?.timezone || 'America/New_York';
  
  // Get tasks for this window
  const tasks = await getTasksForWindow(supabase, userId, window, timezone);
  
  if (tasks.length > 0) {
    return buildBranch1Context(call.name, tasks, window, supabase, userId, timezone);
  } else {
    const topics = await getTopicsForWindow(supabase, userId, window);
    return buildBranch2Context(call.name, topics, window);
  }
}
```

## Phase 5: Branch 1 and Branch 2 Templates

**6am Morning Kickstart - Branch 1 (Tasks exist):**
Per your request, shows morning tasks + all remaining tasks for the day:

```typescript
function buildMorningBranch1(tasks: any[], allDayTasks: any[], timezone: string): string {
  const morningTasks = tasks.filter(t => isInWindow(t.start_time, 'morning', timezone));
  const restOfDay = allDayTasks.filter(t => !isInWindow(t.start_time, 'morning', timezone));
  
  return `CALL TYPE: Morning Kickstart

[CALL AGENDA - MUST COVER ALL]
1. Greet: "Hello Sir."
2. Share morning tasks: "${formatTaskList(morningTasks)}"
3. Share rest of day overview: "${formatTaskList(restOfDay)}"
4. Ask: "Would you like to confirm these for today, adjust them, or skip?"
5. If confirm: "Understood. I will call you back later to go over plans. Goodbye."
6. If adjust: Capture edits, push to scheduler, confirm changes.

Remember: Keep it natural and conversational.`;
}
```

**6am Morning Kickstart - Branch 2 (No tasks):**

```typescript
function buildMorningBranch2(): string {
  return `CALL TYPE: Morning Kickstart (No Tasks)

[CALL AGENDA]
1. Greet: "Hello Sir."
2. Say: "I am just calling to help you get started with your day. I will call you back in a few hours to go over plans. Goodbye."

Remember: Keep it brief and encouraging.`;
}
```

**9am Business Hours - Branch 2 (Topic Jog):**

```typescript
function buildBusinessBranch2(topics: any[]): string {
  const topicList = topics.map(t => `- ${t.topic_name}: ${t.topic_summary}`).join('\n');
  
  return `CALL TYPE: Business Hours Start (No Scheduled Tasks)

[CALL AGENDA]
1. Greet: "Hello Sir."
2. Topic jog: "You have no scheduled items for the next few hours. To jog your memory, here are the main topics you have been working on:
${topicList}
Do you want to work on any of these right now?"
3. If yes to a topic: List real tasks under that topic, ask which to include, push to scheduler.
4. If no: "Understood. I will check back at the next scheduled call. Goodbye."

Remember: Let the user lead the selection.`;
}
```

## Phase 6: Add Branching to send-chat-message

**Modify: `supabase/functions/send-chat-message/index.ts`**

Update `buildCallContext()` to include the same window detection and branching logic:

```typescript
// Add same buildWindowTransitionContext helper
// Reuse the same logic from twilio-scheduled-call

async function buildCallContext(callType: string, context: string | undefined, userId: string, supabase: any): Promise<string> {
  // Check for window marker
  const windowMatch = context?.match(/\[WINDOW:(\w+)\]/);
  
  if (windowMatch) {
    const window = windowMatch[1];
    return buildWindowTransitionContext(callType, context, userId, window, supabase);
  }
  
  // Existing switch/case logic...
}
```

## Phase 7: Add Default Window Calls to Settings

**Modify: `src/components/VoiceAssistantSettings.tsx`**

Add 5 new entries to `DEFAULT_SCHEDULED_CALLS`:

```typescript
const DEFAULT_SCHEDULED_CALLS: ScheduledCall[] = [
  // Existing 3 calls...
  
  // Window Transition Calls (disabled by default)
  {
    id: 'window_morning',
    name: 'Morning Kickstart',
    time: '06:00',
    enabled: false,
    callType: 'custom',
    commsMode: 'phone',
    context: `[WINDOW:morning]
Morning kickstart call. 

BRANCH 1 (morning tasks exist):
- Greet: "Hello Sir."
- List morning tasks for this time window
- List all remaining tasks for the rest of the day
- Ask: "Would you like to confirm these for today, adjust them, or skip?"
- If confirm: "Understood. I will call you back later. Goodbye."
- If adjust: Capture edits, confirm changes.

BRANCH 2 (no morning tasks):
- Greet: "Hello Sir."
- Say: "I am just calling to help you get started with your day. I will call you back in a few hours. Goodbye."`
  },
  {
    id: 'window_business',
    name: 'Business Hours Start',
    time: '09:00',
    enabled: false,
    callType: 'custom',
    commsMode: 'phone',
    context: `[WINDOW:business_hours]
Business hours start call.

BRANCH 1 (tasks in next 3 hours):
- Greet: "Hello Sir."
- List tasks for the next few hours
- Ask: "Which one do you want to start with?"

BRANCH 2 (no tasks):
- Greet: "Hello Sir."
- Topic jog: Share main business-hour topics being worked on
- Ask: "Do you want to work on any of these right now?"
- If yes: List tasks under that topic, capture selection, schedule them`
  },
  {
    id: 'window_eod',
    name: 'Daily Wrap-up',
    time: '17:00',
    enabled: false,
    callType: 'custom',
    commsMode: 'phone',
    context: `[WINDOW:after_work]
End of day wrap-up call.

WRAP-UP FLOW:
- Greet: "Hello Sir."
- Ask: "Any tasks completed today that I should mark done?"
- Ask: "Any tasks blocked or to move to another day?"
- Update statuses accordingly

BRANCH 1 (after-work tasks exist):
- Remind about after-work tasks
- Ask: "Do you want to keep these as-is, adjust them, or skip?"

BRANCH 2 (no after-work tasks):
- Topic jog with after-work topics
- Ask: "Do you want to work on any of these during this time window?"`
  },
  {
    id: 'window_evening',
    name: 'Evening Start',
    time: '19:00',
    enabled: false,
    callType: 'custom',
    commsMode: 'phone',
    context: `[WINDOW:evening]
Evening start call.

BRANCH 1 (evening tasks exist):
- Greet: "Hello Sir, I hope you are enjoying your evening."
- List evening tasks
- Ask: "Do you want to confirm, adjust, or skip?"

BRANCH 2 (no evening tasks):
- Greet: "Hello Sir, I hope you are enjoying your evening."
- Topic jog with evening topics
- Ask: "Do you want to work on any of these tonight?"`
  },
  {
    id: 'window_weekend',
    name: 'Weekend Morning',
    time: '10:00',
    enabled: false,
    callType: 'custom',
    commsMode: 'phone',
    context: `[WINDOW:weekends]
Weekend morning call (Saturday/Sunday only).

BRANCH 1 (weekend tasks for today):
- Greet: "Hello Sir, I hope you get a chance to enjoy your weekend."
- List today's weekend tasks
- Ask: "Do you want to confirm, adjust, or skip?"

BRANCH 2 (no weekend tasks):
- Greet: "Hello Sir, I hope you get a chance to enjoy your weekend."
- Topic jog with life/weekend topics
- Ask: "Do you want to work on any of these today?"`
  }
];
```

## Phase 8: Tangent Handling (Already Works)

The existing `agenda-manager` + `hybrid-assistant-api` integration handles tangents:

1. **Core instructions in queue**: When `buildCallContext()` returns the agenda, it's parsed by `agenda-manager.initialize()` and stored in `conversation_agenda` table

2. **Tangent detection**: User asks off-topic question, AI naturally answers it

3. **Resume**: `agenda-manager.get_status()` is called at each turn and injects remaining agenda items:
   ```
   CONVERSATION AGENDA:
   - [completed] Greet warmly
   - [in_progress] Share today's schedule  
   - [pending] Ask about blockers
   ```

4. **What you mention during call**: Captured as regular conversation messages in `conversation_messages`, which RAG system retrieves for future context

**No changes needed** - existing pattern handles:
- Pauses agenda item with `paused_for` = user's tangent question
- Injects "Coming back to: [agenda item]" via `get_resume_hint`
- Resumes when AI completes tangent response

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/xxx_topic_index.sql` | Topic tables + RLS policies + triggers |
| `supabase/functions/classify-task-topic/index.ts` | AI-powered topic classification |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/twilio-scheduled-call/index.ts` | Add `buildWindowTransitionContext()` with branching |
| `supabase/functions/send-chat-message/index.ts` | Add same branching logic for app_message mode |
| `src/components/VoiceAssistantSettings.tsx` | Add 5 window-transition calls to defaults |

## Implementation Order

1. **Database**: Create topic index tables + triggers
2. **Edge Function**: Build `classify-task-topic`
3. **Context Builder**: Extend `buildCallContext()` in both edge functions
4. **Default Calls**: Add 5 window entries to VoiceAssistantSettings
5. **Testing**: Create tasks, verify topic creation, test each call type

## Task Query Rules

All tasks queried for window calls:
- `title NOT ILIKE '%test%'` - Exclude test tasks
- `status != 'BLOCKED'` - Exclude blocked tasks  
- Match window affinity based on category (using existing `schedulingRules.ts` mappings)
- No 30-day limit - all qualifying tasks can be mentioned

## Summary

| Goal | Solution |
|------|----------|
| 5-6 window-transition recurring calls | Add as `DEFAULT_SCHEDULED_CALLS` entries with `[WINDOW:x]` marker |
| Dynamic subject groupings | New `task_topic_index` + reactive trigger on task changes |
| "Jog memory" fallback | Query topics by window affinity when no tasks |
| Branching (tasks vs no tasks) | Logic in `buildWindowTransitionContext()` |
| 6am shows morning + rest of day | Special handling in `buildMorningBranch1()` |
| Tangent handling + resume | Already works via `agenda-manager` |
| Works for all modes | Phone + App Message get full branching |
| All tasks (not just 30 days) | Query all non-blocked, non-test tasks |
| Topics auto-maintained | Database trigger on task INSERT/UPDATE/DELETE |

