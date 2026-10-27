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

### C2-BYPASS2 -- the TABLE itself is writable with the public anon key (REFUTES "closes C2-SEC1")
- O live (Supabase MCP, project wwxgajrtmslzklnyplah, 2026-10-27 ~20:10 UTC) `pg_policies` for `public.push_subscriptions`:
  ONE policy, `"Service role full access"`, `roles={public}`, `cmd=ALL`, `qual=true`, `with_check=true`. The name says
  service role but there is no `TO service_role`, so it applies to EVERY role. Source:
  `supabase/migrations/20260204173114_...sql:17-19`.
- O live `information_schema.role_table_grants`: `anon` and `authenticated` hold DELETE, INSERT, SELECT, UPDATE (and TRUNCATE).
- O live, read-only, rolled back: `begin; set local role anon; select count(*) ... from public.push_subscriptions; rollback;` ->
  `role_now=anon, rows_visible_to_anon=4, users_visible=1, fcm_tokens_visible=2`. The anon role reads every user's FCM tokens.
- I (high confidence, not exercised over HTTP because this sandbox's egress proxy refuses supabase.co with a CONNECT 403):
  `POST /rest/v1/push_subscriptions` with `apikey`/`Bearer` = the public anon key and
  `{user_id:<victim>, endpoint:"fcm:x", fcm_token:<attacker>}` inserts a journey-native FCM row for the victim. That is the exact
  takeover Option A exists to stop, with no edge function in the path. SELECT also hands an attacker every device token, and an
  anon DELETE removes any row.
- The record does not list this. Gating `subscribe_fcm` does not close the hole while the table policy is open to anon.

### C2 -- the edge-function gate itself (in isolation): CONFIRMED
- Forged or expired JWT -> `auth.getUser` error -> `none` -> 401 (`push-auth.ts mintCaller`; tests "service-role key, forged JWT ...").
- Service-role key on manage-push -> 401: `callerIsUser` passes `""` as the service key, so the service-role branch can never match,
  and `getUser(service key)` has no user id. Test-covered. My mutation M1 (below) FIRED.
- userId case or whitespace: strict `===` against `getUser().user.id`, so it fails closed (401). Missing userId -> 400 before the gate.
- JWT for A + body userId A: the endpoint is fixed to `fcm:<A>`, so A can only write A's row. Residual (not listed in the record):
  verified user A may register a DEVICE TOKEN that belongs to B, and the J14 dedupe then deletes B's row for that token. With
  BYPASS2's anon SELECT exposing every token, that is reachable. The record's "cannot be triggered by an unverified caller"
  is literally true but incomplete.
