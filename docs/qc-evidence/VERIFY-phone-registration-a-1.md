# VERIFY-phone-registration-a-1

<!--
WHAT:       independent verifier verdicts for Option A (phone registration carries the user's own login), loop 1
WHY:        owner-approved Option A (2026-10-27) needs a cold adversarial read before PR #65 merges
SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
EVIDENCE:   journey-voice 167699b (PR #65), android-bridge-template 894154e, huddle-extension-app origin/main 1ddb3e4
-->

Verifier started 2026-10-27 19:57 UTC. Clones: journey-voice @167699b, android-bridge-template @894154e,
huddle-extension-app origin/main @1ddb3e4. O = observed, I = inference.

## C1 -- every real caller of subscribe_fcm / register_push_token

- O `huddle-proxy/index.ts:198-208` calls execute-tool with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`;
  execute-tool's `SUPABASE_SERVICE_KEY` (`index.ts:42`) reads the same env var, so `mintCaller` returns
  `service_role` and Huddle's phone registration passes. Huddle path: `HuddleView.tsx:1235` ->
  `registerBridgeFcmToken` (`huddle.functions.ts:7997`) -> `invokeJourneyTool` -> huddle-proxy `/tool`.
  Huddle phone registration: NOT broken. CONFIRMED.
- Web callers (`bridgeFcmRegistration.ts`, `useNotifications.tsx`): see C1-web below.

## C2 -- can the check be bypassed

### C2-BYPASS1 (REFUTES "a registration that does not carry the matching user's login is refused")
- O huddle-extension-app `src/features/huddle/lib/journey/proxy.functions.ts:211` `invokeJourneyToolDebug` is a
  client-callable `createServerFn` taking ARBITRARY `toolName`, `args`, and `caller.entra_email` from the request
  body. `src/start.ts` registers only `errorMiddleware` (no auth); no `staticwebapp.config.json` exists, so no SWA
  route auth either.
- O huddle-proxy `resolveUserId` (`index.ts:92-123`) maps `caller.entra_email` to a journey user_id with no proof.
- O execute-tool's new gate accepts the service-role bearer huddle-proxy always sends.
- So: POST that server fn with `{toolName:"register_push_token", args:{fcm_token:<attacker token>}, caller:{entra_email:<victim>}}`.
  No `app` arg -> `registerPushToken` writes endpoint `fcm:<token32>` -- a JOURNEY-NATIVE row (not excluded by
  `send-push-notification`'s `not like 'fcm:app:%'`), so the victim's journey alarms, with their 7-day action tokens
  (service-role scheduler + own task -> minted), reach the attacker's device. No JWT and no anon key needed.
- `registerBridgeFcmToken` (`huddle.functions.ts:7997`) is the same shape but forces `app:"huddle"` (Huddle-only pushes).
- I: not exercised live (would write a real row). Reachability of Huddle server fns without auth is documented in
  huddle-extension-app CLAUDE.md (test-agent-serverfn harness calls them over HTTPS with no login).
- The record's "Still in place after Option A" does NOT list this; it describes huddle-proxy as a trusted caller.
- Pre-existing (execute-tool was fully open before #65), but it means Option A does not close C2-SEC1.
