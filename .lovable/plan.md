

User wants a UI-level catch for OpenAI quota exhaustion so they see a clear "credits exhausted" message instead of a generic 500.

## What already exists
- `src/components/QuotaAlertBanner.tsx` — already polls `error_log` for `quota_exceeded_openai` / `quota_exceeded_elevenlabs` and shows a red banner with a billing link. Mounted globally (need to confirm).
- Last turn's edge fix: `hybrid-assistant-api` now detects `rate_limit_exceeded` / "quota" in OpenAI's `last_error` and returns a clearer error string.

## Gaps
1. The edge function returns the quota message in `error`, but callers (`useChatAssistant`, `DailyReviewModal`) just surface a generic "Edge function returned 500" toast. The quota signal is lost.
2. No row is being written to `error_log` with `error_type='quota_exceeded_openai'` when the assistant run fails this way, so `QuotaAlertBanner` never lights up.
3. Need to verify `QuotaAlertBanner` is actually mounted in `App.tsx` / `MainLayout.tsx`.

## Plan

**A. Edge side (`hybrid-assistant-api`)**
- When quota is detected, before returning the error response, insert a row into `error_log` with `error_type='quota_exceeded_openai'`, message, and context (user_id, thread_id). This is what `QuotaAlertBanner` is already watching for.
- Return a structured payload: `{ success: false, error: "...", code: "QUOTA_EXCEEDED", provider: "openai" }` so clients can branch.

**B. Client side (`useChatAssistant.ts`)**
- After invoke, inspect `data?.code === 'QUOTA_EXCEEDED'` (and also pattern-match `error` string for "quota"/"insufficient_quota" as fallback).
- On match: show a `sonner` toast with action button → opens OpenAI billing; replace the in-flight bubble with a friendly "Iris is offline — AI credits exhausted. Add credits to continue." instead of a tool error.

**C. Modal side (`DailyReviewModal.tsx`)**
- Same detection in the morning-review path; render an inline alert (using existing `Alert` component) above the chat panel when quota is the failure mode, so it's visible without scrolling.

**D. Verify banner mounting**
- Check `App.tsx` for `<QuotaAlertBanner />`. If missing, mount it once near the root so it appears across all routes.

## Files to change
- `supabase/functions/hybrid-assistant-api/index.ts` — write to `error_log` + return `code/provider`
- `src/hooks/useChatAssistant.ts` — quota branch with toast + friendly message
- `src/components/DailyReviewModal.tsx` — inline alert on quota failure
- `src/App.tsx` (only if `<QuotaAlertBanner />` not already mounted)

## Verification
- Temporarily force the quota path (or wait for next 500) → banner appears within 60s, toast fires immediately, modal shows inline alert, chat bubble shows friendly text not "500".
- Confirm `error_log` row written with `error_type='quota_exceeded_openai'`.

No schema changes. No scheduling/timezone code touched (pre-flight: clean).

