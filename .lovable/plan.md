

# Three Fixes: Batch Group Move, Sub-Groups, and Voicemail Chat Fallback

## Issue 1: Batch Move to Topic Group

Currently the sticky action bar only shows "Move to [Category]". There is no option to batch-move selected tasks into a specific topic group.

### Changes

**File: `src/pages/Priorities.tsx`**
- Add a `batchMoveToGroup` function that:
  1. Deletes existing `task_topic_mappings` for all selected task IDs
  2. Inserts new mappings pointing to the target topic group
  3. Optionally updates the task category to match the group's `category_affinity`
- Add a second dropdown in the sticky action bar: "Move to Group..." listing all topic groups (grouped by category for clarity)

**File: `src/pages/Priorities.tsx` (action bar, lines 498-521)**
- Add a second `DropdownMenu` next to the existing "Move to..." category button
- Label: "Move to Group..."
- Items: `allTopicGroupRefs` grouped by category sub-headers

---

## Issue 2: Sub-Groups (Hierarchical Topic Groups)

You want to support structures like MIT > Course A > Task 1 without breaking chat/voice. The approach: add a `parent_topic_id` column to `task_topic_index` so groups can nest. The UI renders nested groups with indentation. Chat and voice continue to work because they query topics by `user_id` -- the parent relationship is purely a UI/organizational concern.

### Database Migration

Add `parent_topic_id` to `task_topic_index`:

```sql
ALTER TABLE public.task_topic_index
ADD COLUMN parent_topic_id UUID REFERENCES public.task_topic_index(id) ON DELETE SET NULL;
```

### UI Changes

**File: `src/pages/Priorities.tsx` (loadData)**
- When building `catTopics`, organize topics into a tree: top-level topics have `parent_topic_id = null`, children are nested under their parent
- Pass a `children` array to each `TopicGroupData`

**File: `src/components/priorities/TopicGroupPanel.tsx`**
- Accept an optional `children: TopicGroupData[]` prop
- Render child groups indented inside the collapsible content, above the task list
- Each child is itself a `TopicGroupPanel` (recursive), allowing arbitrary nesting
- Add a "Add Sub-Group" option in the group's context menu (the "..." button or a new one)

**File: `src/components/priorities/AddTopicGroupDialog.tsx`**
- Accept an optional `parentTopicId` prop
- When saving, include `parent_topic_id` in the upsert payload

### Chat/Voice Impact: None
- `get_tasks_by_topic` queries `task_topic_mappings` by topic name -- sub-groups are just additional topic names
- The agenda manager and check-in flow present topic groups as a flat list of names -- this still works. If a parent has no direct tasks but has children, the chat will show the children as separate selectable topics
- No changes to `tool-definitions.ts`, `persona.ts`, or `call-context-builder.ts`

---

## Issue 3: Voicemail Fallback to Chat (Not Just Slack)

The `status-callback` in `twilio-voice-handler` currently hardcodes `channels: ['SLACK']` when a call is missed or goes to voicemail. It should respect the user's configured fallback preference and default to `app_message` (chat) instead of Slack.

### Changes

**File: `supabase/functions/twilio-voice-handler/index.ts` (status-callback, lines 1446-1534)**

Current behavior (line 1508):
```typescript
channels: ['SLACK'],  // hardcoded
```

Fix:
1. Look up the user's `scheduled_calls` config from `user_scheduling_prefs` to find the `fallbackMode` for the specific call that was missed
2. If no `fallbackMode` is configured, default to `'app_message'` (chat)
3. Route based on the fallback mode:
   - `'app_message'`: Call `send-chat-message` edge function to deliver the agenda as a chat message (same pattern as `twilio-scheduled-call` uses for `commsMode: 'app_message'`)
   - `'slack'`: Current behavior (call `send-unified-notification` with `channels: ['SLACK']`)
   - `'email'`: Call `send-unified-notification` with `channels: ['email']`

**File: `src/components/VoiceAssistantSettings.tsx`**
- Add a `fallbackMode` field to each scheduled call card (dropdown: App Message, Slack, Email)
- Default to `'app_message'`

**File: `src/services/schedulingService.ts`**
- Add `fallbackMode?: CommsMode` to the `ScheduledCall` interface

**File: `supabase/functions/twilio-scheduled-call/index.ts`**
- Add `fallbackMode` to the `ScheduledCall` interface (for type consistency)

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `src/pages/Priorities.tsx` | Add `batchMoveToGroup`, second dropdown in action bar, tree-building logic in `loadData` |
| `src/components/priorities/TopicGroupPanel.tsx` | Accept `children` prop, render sub-groups recursively, "Add Sub-Group" action |
| `src/components/priorities/AddTopicGroupDialog.tsx` | Accept `parentTopicId` prop, include in upsert |
| `supabase/functions/twilio-voice-handler/index.ts` | Look up user fallbackMode in status-callback, route to chat/slack/email accordingly |
| `src/components/VoiceAssistantSettings.tsx` | Add fallbackMode selector per scheduled call |
| `src/services/schedulingService.ts` | Add `fallbackMode` to `ScheduledCall` type |
| `supabase/functions/twilio-scheduled-call/index.ts` | Add `fallbackMode` to interface |
| **Migration** | `ALTER TABLE task_topic_index ADD COLUMN parent_topic_id UUID REFERENCES task_topic_index(id) ON DELETE SET NULL` |

## What Stays the Same

- Chat interactive check-in flow and agenda manager -- unaffected
- Voice/phone call flows -- unaffected
- `tool-definitions.ts`, `persona.ts`, `call-context-builder.ts` -- no changes needed
- `classify-task-topic` edge function -- unaffected (assigns to flat topics, sub-grouping is manual)

