

# Updated Plan: Fix Daily Review + Guarantee Logging Visibility

## Addition: RLS / Silent Failure Diagnostics

The `activityLogger.ts` currently does `.catch(() => {})` — completely silent. If the POST returns a 403, 401, or any RLS denial, we'd never know. This is the root cause of missing `daily_review_reasoning` entries for the dev user.

### What we'll add

**In `src/utils/activityLogger.ts`:**
- Replace the silent `.catch(() => {})` with a `.then(res => { if (!res.ok) console.error('[activityLogger] POST failed:', res.status, res.statusText) })` so RLS denials become visible in the browser console
- Add the response body text on failure for full context (RLS errors return a JSON body)
- Keep fire-and-forget semantics (still don't throw or block)

**In `src/utils/dailyReviewPipeline.ts`:**
- After calling `logActivity`, add a fallback `console.log('[DailyReviewPipeline] trace:', JSON.stringify(reasoning.stats))` so even if the DB write fails, the trace appears in the browser console
- This ensures we can always verify pipeline output even with broken logging

**In `src/components/DailyReviewModal.tsx`:**
- On modal open, call `onTaskUpdate()` to force a task reload before the pipeline runs
- This prevents stale data from `useUnifiedTasks`

### Other items (unchanged from approved plan)

1. **Use real user config** — fetch `user_scheduling_prefs` and pass to pipeline instead of `DEFAULT_SCHEDULING_CONFIG`
2. **Chat isolation** — filter modal chat messages by a `reviewSessionId` instead of global stream
3. **Keyword-aware scheduling** — apply `contextRules.keywords` in `nightly-schedule-builder` to override window placement (fixes mall at 9pm)
4. **Structured builder logging** — add `steps[]` array with `runId` and `triggerSource` to `nightly-schedule-builder`

## Files Changed

| File | Change |
|------|--------|
| `src/utils/activityLogger.ts` | Log POST response status on failure instead of swallowing |
| `src/utils/dailyReviewPipeline.ts` | Console fallback trace, accept `userConfig` param |
| `src/components/DailyReviewModal.tsx` | Force task reload on open, fetch user config, chat isolation |
| `supabase/functions/nightly-schedule-builder/index.ts` | Keyword overrides, structured step logging |
| `public/sw.js` | Bump cache to v10 |
| `index.html` | Update build-version meta |

