

## Problem Summary

The Cloudflare Worker is running an outdated version (`2026-01-25-cf-v1`) while the Lovable codebase has the correct fixes (`2026-01-28-cf-v2`). This version mismatch means:
- The old worker still expects raw audio bytes from ElevenLabs TTS (incorrect)
- The old worker doesn't have the field mapping fixes for `audio_base64` and `voice_id`
- The old worker doesn't log to `activity_log`/`error_log` in Supabase

The GitHub Actions workflow ran successfully, but against an older commit that didn't include the latest fixes.

---

## Proposed Solution

### Step 1: Force Version Bump to Trigger Fresh Deployment

Bump the version string to a new value that's guaranteed to be different, ensuring we can verify the deployment actually propagated.

**File**: `cloudflare/src/index.ts`
- Change version from `2026-01-28-cf-v2` to `2026-01-28-cf-v3`

**File**: `cloudflare/src/TwilioCallSession.ts`  
- Change `WORKER_VERSION` from `2026-01-28-cf-v2` to `2026-01-28-cf-v3`

**File**: `.github/workflows/deploy-cloudflare.yml`
- Update `EXPECTED_VERSION` from `2026-01-28-cf-v2` to `2026-01-28-cf-v3`

### Step 2: Add Deployment Verification Log

Add a console log at the very start of the worker to confirm which code is running when the WebSocket connects.

**File**: `cloudflare/src/TwilioCallSession.ts`
- Add at the start of `handleStart()`: `console.log('[CF] WORKER VERSION:', WORKER_VERSION);`

### Step 3: Verify Deployment After Push

After the code is pushed and GitHub Actions completes:
1. Check `/health` endpoint returns version `2026-01-28-cf-v3`
2. Trigger a test call
3. Verify `activity_log` shows `worker_version: 2026-01-28-cf-v3` in metadata
4. Confirm audio plays correctly (no silence)

---

## Technical Details

### Why the Workflow Passed But Worker Didn't Update

GitHub Actions workflow shows commit `4b17be5` ("Improve Cloudflare TTS flow") ran successfully. However, the health check in the workflow expected `2026-01-28-cf-v2` and the live worker shows `2026-01-25-cf-v1`. This suggests:
- Either the workflow didn't actually check the version properly, OR
- The workflow passed against cached/stale CDN response, OR
- The secrets or deployment failed silently

The version bump to `-v3` creates a clear test: if the health check passes with `-v3`, we know for certain the new code deployed.

### Files Being Changed

| File | Change |
|------|--------|
| `cloudflare/src/index.ts` | Version bump in `/health` response |
| `cloudflare/src/TwilioCallSession.ts` | Version bump + startup log |
| `.github/workflows/deploy-cloudflare.yml` | Expected version updated |

### Verification Checklist

After deployment:
- [ ] `GET /health` returns `{"version":"2026-01-28-cf-v3"}`
- [ ] Test call plays greeting audio (not silence)
- [ ] `activity_log` contains records with `worker_version: 2026-01-28-cf-v3`
- [ ] ElevenLabs TTS responses are parsed correctly (JSON with base64)

