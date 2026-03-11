

# Bump Cloudflare Worker Version for Auto-Deploy

## Problem
The worker code was updated (model, VAD, call_sessions logging) but the version string was never bumped. All three files still say `2026-02-10-cf-v8`. This needs to become `2026-03-11-cf-v9` so the CI health check passes after deploy.

## Changes (3 files, 1 line each)

1. **`cloudflare/src/index.ts`** line 21: `'2026-02-10-cf-v8'` → `'2026-03-11-cf-v9'`
2. **`cloudflare/src/TwilioCallSession.ts`** line 77: `'2026-02-10-cf-v8'` → `'2026-03-11-cf-v9'`
3. **`.github/workflows/deploy-cloudflare.yml`** line 53: `"2026-02-10-cf-v8"` → `"2026-03-11-cf-v9"`

## Deploy Flow
After these edits, you click **Publish** in Lovable → pushes to `main` → GitHub Action triggers (path filter matches `cloudflare/**`) → `npx wrangler deploy` → health check verifies version → done.

