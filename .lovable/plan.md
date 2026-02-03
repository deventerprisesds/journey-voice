
# Plan: Fix Batch Scheduler Date Hallucination with Explicit Dating and Tracing

## Summary

This plan fixes the root cause of tasks being created with wrong dates by:
1. Explicitly telling the AI "TODAY IS 2026-02-03" in an unambiguous ISO format
2. Creating a separate ISO date variable for use in prompt examples
3. Adding comprehensive tracing of AI input/output for debugging
4. Fixing UI issues (FocusView "Other" bucket, Kanban arrows, SmartTaskInput mobile)

---

## Root Cause Analysis

### The Problem

In `batch-calendar-scheduler/index.ts`, the AI prompt uses `${targetDateStr}` in example ISO timestamps (lines 200, 207-208):

```typescript
// Line 156-158
const targetDateStr = targetDateObj 
  ? targetDateObj.toLocaleDateString('en-US', { timeZone: timezone, dateStyle: 'full' })
  : 'today or tomorrow based on current time';

// This produces "Monday, February 3, 2026"

// Lines 200, 207-208 use this in examples:
"${targetDateStr}T10:00:00-05:00"  
// Results in: "Monday, February 3, 2026T10:00:00-05:00" ← INVALID ISO!
```

The AI sees malformed examples and hallucinates dates, returning Feb 2 instead of Feb 3.

### Missing Context

The AI is never explicitly told what today's date is in an unambiguous format. Line 174 shows:

```typescript
CURRENT TIME: ${now.toLocaleString('en-US', { timeZone: timezone })}
// Outputs: "2/3/2026, 9:30:00 AM"
```

This "2/3/2026" format can be misinterpreted as March 2nd (European) vs February 3rd (US).

---

## Technical Fixes

### Fix 1: Add Explicit ISO Date + Improve Prompt Context

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

```typescript
// After line 72 (const now = new Date()):
// Create unambiguous date strings
const todayISO = now.toISOString().split('T')[0];  // "2026-02-03"
const todayReadable = now.toLocaleDateString('en-US', {
  timeZone: timezone,
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});  // "Monday, February 3, 2026"

// After line 158, add:
const targetDateISO = targetDateObj 
  ? targetDateObj.toISOString().split('T')[0]  // "2026-02-03"
  : todayISO;

// Replace line 171-175 with explicit date context:
const batchPrompt = `You are a scheduling assistant. Schedule ALL ${tasks.length} tasks efficiently, avoiding conflicts.

=== CRITICAL DATE CONTEXT (READ CAREFULLY) ===
TODAY'S DATE (ISO): ${todayISO}
TODAY'S DATE (Readable): ${todayReadable}
TARGET SCHEDULING DATE: ${targetDateISO} (${targetDateStr})
CURRENT TIME: ${now.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })}
TIMEZONE: ${timezone}

IMPORTANT: ALL scheduled times MUST be on or after ${targetDateISO}. 
NEVER schedule anything before ${todayISO}.
==============================================

// Lines 200, 207-208: Replace ${targetDateStr} with ${targetDateISO}:
- Example for ${timezone}: "${targetDateISO}T12:00:00-05:00" (noon Eastern with offset)
...
[
  { "taskIndex": 0, "start_time": "${targetDateISO}T10:00:00-05:00", "end_time": "${targetDateISO}T11:00:00-05:00", "reasoning": "brief reason" },
  { "taskIndex": 1, "start_time": "${targetDateISO}T14:00:00-05:00", "end_time": "${targetDateISO}T15:00:00-05:00", "reasoning": "brief reason" },
  ...
]
```

### Fix 2: Add Input/Output Tracing for Debugging

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

Add logging before and after AI call:

```typescript
// Before line 217 (const aiResponse = await fetch...):
console.log('=== BATCH SCHEDULER AI INPUT ===');
console.log('Today ISO:', todayISO);
console.log('Target Date ISO:', targetDateISO);
console.log('Target Date Readable:', targetDateStr);
console.log('Tasks count:', tasks.length);
console.log('Prompt length:', batchPrompt.length);
console.log('First 500 chars of prompt:', batchPrompt.substring(0, 500));
console.log('=================================');

// After line 259 (const aiContent = ...):
console.log('=== BATCH SCHEDULER AI OUTPUT ===');
console.log('Raw AI response (first 1000 chars):', aiContent?.substring(0, 1000));
console.log('==================================');

// After line 283 (successful parse):
console.log('=== BATCH SCHEDULER PARSED RESULTS ===');
scheduledResults.forEach((r, i) => {
  console.log(`  Slot ${i}: taskIndex=${r.taskIndex}, start=${r.start_time}, end=${r.end_time}`);
  const dateFromResult = r.start_time?.split('T')[0];
  if (dateFromResult && dateFromResult < todayISO) {
    console.error(`  ⚠️ WARNING: Slot ${i} has PAST date ${dateFromResult} (today is ${todayISO})`);
  }
});
console.log('======================================');
```

### Fix 3: Add Same Validation in ai-task-parser

**File**: `supabase/functions/ai-task-parser/index.ts` (around line 401-418)

Add date validation when merging batch results:

```typescript
// Before merging, get today's date
const todayISO = new Date().toISOString().split('T')[0];

const tasksWithPreview = tasks.map((task: any, idx: number) => {
  const scheduled = batchResult.scheduled?.find((s: any) => s.taskIndex === idx);
  if (scheduled?.start_time && scheduled?.end_time) {
    // VALIDATE: Reject past dates
    const scheduledDate = scheduled.start_time.split('T')[0];
    if (scheduledDate < todayISO) {
      console.error(`[PARSER] REJECTED: Batch returned past date ${scheduledDate} for "${task.title}" (today=${todayISO})`);
      return { ...task, needsScheduling: true };  // Don't apply bad data
    }
    
    return {
      ...task,
      start_time: scheduled.start_time,
      end_time: scheduled.end_time,
      scheduling_note: scheduled.reasoning || null,
      isPreview: true,
    };
  }
  return { ...task, needsScheduling: true };
});
```

### Fix 4: FocusView "Other" Time Bucket

**File**: `src/components/FocusView.tsx`

Add "Other" bucket for tasks outside defined windows:

```typescript
// Line 79 - Add to timeWindowStyles:
other: { 
  icon: <Clock className="h-4 w-4" />, 
  label: 'Other Times', 
  bgClass: 'bg-gray-50 dark:bg-gray-950/20',
  borderClass: 'border-l-4 border-l-gray-400',
  textClass: 'text-gray-700 dark:text-gray-300'
},

// Line 177-182 - Add 'other' to tasksByWindow:
const tasksByWindow: Record<string, Task[]> = {
  morning: [],
  business_hours: [],
  after_work: [],
  evening: [],
  other: [],  // NEW: catch-all bucket
};

// Lines 184-189 - Push to 'other' when window is null:
scheduledToday.forEach(task => {
  const window = getTimeWindowForTask(task);
  if (window && tasksByWindow[window]) {
    tasksByWindow[window].push(task);
  } else {
    tasksByWindow['other'].push(task);  // NEW: fallback
  }
});
```

Also add a new import for Clock icon and render the "Other" section in the timeline.

### Fix 5: Kanban Arrow Viewport Positioning

**File**: `src/components/KanbanBoard.tsx` (lines 1150-1174)

Change from `absolute` to `fixed` positioning:

```typescript
// Line 1151 - Change to fixed:
{canScrollLeft && (
  <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
    <Button
      variant="outline"
      size="icon"
      onClick={scrollLeft}
      className="h-12 w-12 bg-background shadow-xl border-2 hover:bg-background/90 transition-all hover:scale-110"
    >
      <ChevronLeft className="h-5 w-5" />
    </Button>
  </div>
)}

// Line 1164 - Change to fixed:
{canScrollRight && (
  <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50">
    <Button
      variant="outline"
      size="icon"
      onClick={scrollRight}
      className="h-12 w-12 bg-background shadow-xl border-2 hover:bg-background/90 transition-all hover:scale-110"
    >
      <ChevronRight className="h-5 w-5" />
    </Button>
  </div>
)}
```

### Fix 6: SmartTaskInput Mobile Responsive Layout

**File**: `src/components/SmartTaskInput.tsx` (lines 203-236)

Make the layout wrap on mobile with multi-line input support:

```typescript
<form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
  {/* Main input row */}
  <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:w-auto">
    <Input
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder="Describe your task..."
      disabled={isProcessing}
      className="flex-1 min-w-0"
    />
    <Button type="submit" disabled={isProcessing || !input.trim()} size="icon" className="shrink-0">
      {isProcessing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Send className="h-4 w-4" />
      )}
    </Button>
  </div>
  
  {/* Toggle moves to second row on mobile */}
  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/50 rounded-md w-full sm:w-auto justify-center sm:justify-start">
    <Switch 
      checked={includeAssignments} 
      onCheckedChange={setIncludeAssignments}
      id="include-assignments"
      className="scale-90"
    />
    <Label 
      htmlFor="include-assignments" 
      className="cursor-pointer text-xs text-muted-foreground whitespace-nowrap"
      title="Include pending homework assignments in scheduling context"
    >
      + Homework ({selectedAssignmentIds.size})
    </Label>
  </div>
</form>
```

### Fix 7: Bump Version

**File**: `supabase/functions/_shared/config.ts`

```typescript
export const GLOBAL_VERSION = "2026-02-03-v21";
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add `targetDateISO` variable, explicit "TODAY IS" context, use ISO in examples, add AI input/output tracing |
| `supabase/functions/ai-task-parser/index.ts` | Add date validation before merging batch results |
| `supabase/functions/_shared/config.ts` | Bump version to v21 |
| `src/components/FocusView.tsx` | Add "Other" time bucket + Clock import |
| `src/components/KanbanBoard.tsx` | Change arrow positioning from `absolute` to `fixed` |
| `src/components/SmartTaskInput.tsx` | Responsive 2-row layout for mobile |

---

## Expected Tracing Output After Fix

When batch scheduler runs, logs will show:

```text
=== BATCH SCHEDULER AI INPUT ===
Today ISO: 2026-02-03
Target Date ISO: 2026-02-03
Target Date Readable: Monday, February 3, 2026
Tasks count: 3
Prompt length: 2450
First 500 chars of prompt: You are a scheduling assistant...
=== CRITICAL DATE CONTEXT (READ CAREFULLY) ===
TODAY'S DATE (ISO): 2026-02-03
...
=================================

🤖 Calling AI for batch scheduling...
✅ AI responded in 1250ms

=== BATCH SCHEDULER AI OUTPUT ===
Raw AI response (first 1000 chars): [
  { "taskIndex": 0, "start_time": "2026-02-03T10:00:00-05:00", ...
==================================

=== BATCH SCHEDULER PARSED RESULTS ===
  Slot 0: taskIndex=0, start=2026-02-03T10:00:00-05:00, end=2026-02-03T11:00:00-05:00
  Slot 1: taskIndex=1, start=2026-02-03T14:00:00-05:00, end=2026-02-03T15:00:00-05:00
======================================
```

If the AI returns a past date, the log will show:

```text
  ⚠️ WARNING: Slot 2 has PAST date 2026-02-02 (today is 2026-02-03)
```

And the validation layer will reject it.

---

## What's STILL Holding

**TODO vs UP_NEXT status mapping** - Holding until architecture is documented for consistency.
