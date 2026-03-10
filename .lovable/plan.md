

# Full Voice Parity Fix + Scheduling Chain Repair

## Changes Overview

Five targeted changes to bring all voice modes to WebRTC parity and fix the scheduling chain.

---

## 1. Cloudflare Bridge: Model + VAD (fixes silence)

**File**: `cloudflare/src/TwilioCallSession.ts`

- **Line 653**: `gpt-4o-realtime-preview-2024-10-01` → `gpt-4o-realtime-preview-2025-06-03`
  - The Oct 2024 model does NOT support `semantic_vad`. This is why the bridge goes silent after greeting — OpenAI never detects end-of-speech.
- **Line 978**: `eagerness: 'low'` → `eagerness: 'medium'`
  - Matches WebRTC configuration for consistent turn-taking behavior.

## 2. Supabase Bridge: Model + VAD

**File**: `supabase/functions/twilio-realtime-bridge/index.ts`

- **Line 420**: `gpt-4o-realtime-preview-2024-12-17` → `gpt-4o-realtime-preview-2025-06-03`
- **Line 430**: `eagerness: "low"` → `eagerness: "medium"`

## 3. Cloudflare Bridge: call_sessions Logging

**File**: `cloudflare/src/TwilioCallSession.ts`

Add a `callSessionDbId` property. In `handleStart()`, after setting up userId/callSid/streamSid, insert a row into `call_sessions` via Supabase REST (matching the fields from `_shared/call-session.ts`). In `cleanup()`, update that row with `ended_at` and `duration_seconds`. This fixes the NULL duration/ended_at gap.

## 4. Inbound Call Pre-Connect Session

**File**: `supabase/functions/twilio-voice-handler/index.ts`

In the `incoming-call` case, when `selectedMode === 'cloudflare'`, before generating TwiML:
1. Call `twilio-realtime-bridge` with `mode: 'pre-connect'` (same pattern as `notification-delivery`)
2. If successful, use `generateCloudflareTwiMLWithSession()` instead of `generateCloudflareBridgeTwiML()`
3. Fallback to cold-start TwiML if pre-connect fails

This gives inbound calls the same warm-start experience as recurring calls (pre-cached greeting, pre-built instructions, pre-loaded context).

## 5. SQL Migration: Rename Old schedule_next_call

Rename the 7-parameter `schedule_next_call` to `schedule_next_call_v1_backup` so PostgREST can resolve the 8-parameter version without ambiguity. Then re-seed the queue.

```sql
ALTER FUNCTION public.schedule_next_call(uuid, text, text, time, text, text, text)
RENAME TO schedule_next_call_v1_backup;

UPDATE user_scheduling_prefs SET updated_at = now()
WHERE scheduled_calls IS NOT NULL;
```

## Deployment

- Cloudflare changes: require `npx wrangler deploy` after merge
- Supabase bridge: auto-deployed via edge function deployment
- SQL migration: applied through Lovable migration tool

