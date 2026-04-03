

# Fix FocusView Crash + Add Error Logging to ErrorBoundary

Two changes: fix the crash, and make sure future crashes get logged to the database.

## 1. Fix `todayStr` TDZ crash in FocusView

**File**: `src/components/FocusView.tsx`

Move line 257 (`const todayStr = ...`) to line 202, right after `userTimezone` is defined. Remove the original declaration at line 257. This fixes the `ReferenceError: Cannot access 'todayStr' before initialization` that crashes the page.

## 2. Add crash logging to ErrorBoundary

**File**: `src/components/ErrorBoundary.tsx`

In `componentDidCatch`, call `logToErrorLog` from `src/utils/directLog.ts` to send the crash details (component name, error message, stack trace, current URL) to the `error_log` table. This uses the existing direct REST logger that bypasses supabase-js, so it works even when the app is in a broken state.

The error boundary currently only does `console.error` — after this change, every crash will be persisted in the database with:
- `component`: extracted from `errorInfo.componentStack` (first component name)
- `error_type`: `'react_crash'`
- `error_message`: the error's message
- `stack_trace`: full stack
- `context`: current pathname, component stack snippet

Also: show the error message in production too (currently gated behind `import.meta.env.DEV`), so users can report what they see.

## Files changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` | Move `todayStr` declaration before its first use |
| `src/components/ErrorBoundary.tsx` | Log crashes to `error_log` via `directLog`, show error message in prod |

