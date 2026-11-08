# UAT-93 — PR #93 Settings UI on the LIVE web app

<!--
WHAT:       real-browser evidence that PR #93's "Coursework Work Sessions" Settings UI is live and correct
WHY:        owner asked "Uat verify 93" (2026-11-08); the client ships via Lovable publish, so merged != live
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   .github/workflows/verify-uat.yml runs (ids recorded below), screenshots on the `uat-shots` branch
-->

Written as the work happened. Read-only check: nothing is saved, no setting is changed.

## What is being checked (from `origin/main` 3c5aee4, `src/components/SchedulingSettings.tsx` ~L369-420)

| # | Check | Expected |
|---|---|---|
| C0 | Live bundle contains the #93 strings | `Only one paper a night` present in a JS asset served by https://journey-voice.lovable.app |
| C1 | Signed in as the owner (`dev@enterpriseds.io`) | `/settings` renders, not `/auth` |
| C2 | Settings -> Scheduling -> "Coursework Work Sessions" card | card title visible |
| C3 | Checkbox "Only one paper a night (a reading or PowerPoint can share the night)" | present, `id=assignment-sessions-one-paper` |
| C4 | Text field "Words that mark a lighter, finite assignment (comma-separated)" | present; value = `reading, readings, read, chapter, chapters, powerpoint, slides, slide deck, presentation, ppt` (the default in `src/config/schedulingRules.ts:190`, unless the owner saved his own list) |

## Step log

- **Step 1 — facts.** journey workflows already use `secrets.CF_SUPABASE_SERVICE_KEY` (17 uses) as the
  service-role key against `wwxgajrtmslzklnyplah`. No new secret needed. Huddle's generic runner
  (`huddle-extension-app/.claude/skills/test-agent-serverfn/scripts/run-uat.mjs`) reused verbatim.
  The CCR sandbox cannot reach `journey-voice.lovable.app` (proxy CONNECT 403), so every live read
  happens on the GitHub runner.
- **Step 2 — auth design.** Admin `generate_link` (type `magiclink`) mints a one-time token; the runner
  exchanges its `hashed_token` at `/auth/v1/verify` for a session and writes it to the app's own
  storage key `sb-wwxgajrtmslzklnyplah-auth-token`. Chosen over opening `action_link` because the
  action link redirects to the project's configured Site URL / allow-list, which may not be the
  lovable.app origin; the token-hash exchange does not depend on redirect config. No email is sent
  by `generate_link`. No app code changed.
