
# Plan: Fix Up Next Queue Overflow and Auto-Scheduling Bug

## ✅ COMPLETED - February 7, 2026

### Changes Made

1. **Fixed `isRolledOver()` in FocusView.tsx** (lines 135-144)
   - Added whitelist of valid workflow statuses: `['UP_NEXT', 'TODO', 'READY', 'BACKLOG']`
   - Tasks with corrupted status values (PROF_EDUCATION, LIFE, VENTURES, CAREER) are now excluded

2. **Fixed `targetDateObj` in batch-calendar-scheduler** (lines 99-119)
   - Declared `let targetDateObj: Date | null = null;`
   - Assigned properly in both conditional branches
   - Fixes ReferenceError that prevented auto-scheduling

### Expected Results
- Up Next queue shows only tasks with valid workflow statuses
- QuickTaskInput tasks are now auto-scheduled properly
- No more "targetDateObj is not defined" errors

### Optional Database Cleanup
Run this SQL to fix corrupted task statuses:
```sql
UPDATE tasks 
SET status = 'BACKLOG', updated_at = NOW()
WHERE status IN ('PROF_EDUCATION', 'LIFE', 'VENTURES', 'CAREER', 'EDUCATION');
```
