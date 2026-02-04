

# Implementation: Fix Push Notifications & Shortcut Task Input

## Summary

Updating VAPID secrets with the generated valid key pair and refactoring `ItineraryEngine.findOptimalTimeSlot()` to use the working `ai-task-parser` instead of `smart-calendar-scheduler`. The VAPID key generation utility will be kept for future use.

---

## Part 1: Update VAPID Secrets

Update both secrets with the generated values:

| Secret | Value |
|--------|-------|
| `VAPID_PUBLIC_KEY` | `BFTRyPyY3SHyUwoXERMEXOH1kfgB0iIEHmuP1u6rp3V-_pVsp8upDKZDojFvUkztL021Y8v_EdWeK9boXKl67QU` |
| `VAPID_PRIVATE_KEY` | `_pVsp8upDKZDojFvUkztL021Y8v_EdWeK9boXKl67QU` |

---

## Part 2: Refactor ItineraryEngine.findOptimalTimeSlot()

**File: `src/utils/ItineraryEngine.ts`**

Replace the `smart-calendar-scheduler` call (lines 342-356) with `ai-task-parser`:

### Current Code (lines 342-365)
```typescript
const { data, error } = await supabase.functions.invoke('smart-calendar-scheduler', {
  body: {
    taskText,
    targetDate: targetDate?.toISOString() || new Date().toISOString(),
    existingTasks,
    workingMinutes: 420,
    busySlots,
    scheduling_context: this.extractSchedulingContext(taskText, existingTasks[0]?.category)
  }
});

if (error) {
  console.error('Smart scheduler error:', error);
  throw error;
}

return {
  ...data,
  busySlots
};
```

### New Code
```typescript
// Use the working ai-task-parser (same as chat/voice)
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const { data, error } = await supabase.functions.invoke('ai-task-parser', {
  body: {
    text: taskText,
    timezone,
    userId: user.id,
    targetDate: targetDate?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
    existingTasks: existingTasks.map(t => ({
      id: t.id,
      title: t.title,
      start_time: t.start_time,
      end_time: t.end_time,
      category: t.category
    }))
  }
});

if (error) {
  console.error('AI task parser error:', error);
  throw new Error(`Failed to parse task: ${error.message || 'Unknown error'}`);
}

if (!data?.tasks || data.tasks.length === 0) {
  throw new Error('No tasks parsed from input');
}

const parsedTask = data.tasks[0];

return {
  parsedTask: {
    title: parsedTask.title,
    description: parsedTask.description,
    priority: parsedTask.priority,
    category: parsedTask.category,
    estimate_minutes: parsedTask.estimate_minutes || 60,
    due_date: parsedTask.due_date,
    status: parsedTask.status
  },
  scheduledSlot: parsedTask.start_time ? {
    start_time: parsedTask.start_time,
    end_time: parsedTask.end_time
  } : null,
  aiReasoning: `Parsed as ${parsedTask.category} task with ${parsedTask.priority} priority`,
  busySlots
};
```

---

## Files to Modify

| File | Action |
|------|--------|
| **Secrets** | Update `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` |
| `src/utils/ItineraryEngine.ts` | Refactor `findOptimalTimeSlot()` (lines 342-365) |

---

## What Stays Unchanged

- `supabase/functions/generate-vapid-keys/index.ts` - kept for future use
- `supabase/config.toml` - keeps the `generate-vapid-keys` entry
- `smart-calendar-scheduler` - remains available for batch scheduling
- All chat/voice paths continue working as-is

---

## Expected Outcome

1. **Push notifications work** - Valid VAPID keys enable browser push delivery
2. **Shortcut task input works** - Uses same AI path as chat/voice (`ai-task-parser` with `OPENAI_API_KEY`)
3. **Consistent architecture** - Single AI parsing function for all task creation paths

