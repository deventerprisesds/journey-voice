
## Plan: prove it works before you check

Two read-only verification steps, no code changes, no user action needed.

### Step 1 — Verify the published bundle contains the fix

Use `code--fetch_website` on `https://journey-voice.lovable.app`:
- Read the HTML, extract `<meta name="build-version">` → must be `v11`
- Extract the main JS bundle URL from the HTML
- Fetch the JS bundle, grep for the new clamp string (`36 * 60 * 60 * 1000` or `rolledOverIds`)

Outcomes:
- **Bundle is v11 AND contains new clamp** → publish worked. Move to Step 2.
- **Bundle is v10 OR missing new clamp** → publish didn't ship the change. Stop and tell you. No point refreshing.

### Step 2 — Open the live page in a clean browser session

If Step 1 passes, use `browser--navigate_to_url` to open `https://journey-voice.lovable.app/tasks?view=focus` in a fresh automated browser (no SW cache from your device). Then:
- Log in if needed (will stop and ask you first per browser auth rules)
- Open the Daily Review modal
- Screenshot the counts

Outcomes:
- **Counts show 4 / 1** → fix works on a clean device. Your issue is local SW cache; remedy is close all `journey-voice.lovable.app` tabs and reopen, or DevTools → Application → Service Workers → Unregister.
- **Counts show 171 / 39** → fix doesn't work even on clean device. There's a third data path I missed. Stop and re-trace.
- **Counts show something else** → new information, re-investigate.

### What this gives you

A definitive answer in one round: either (a) it's published and works, and your local SW just needs to be evicted, (b) publish didn't ship, or (c) my analysis is incomplete and we keep digging — without you having to refresh anything.

### Files

No file changes in this round. Pure verification.
