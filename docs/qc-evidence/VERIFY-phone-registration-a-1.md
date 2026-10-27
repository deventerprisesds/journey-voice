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

## C1-web -- web callers still pass: CONFIRMED (code read) / I for the header
- O `src/utils/bridgeFcmRegistration.ts:41` and `src/hooks/useNotifications.tsx:82` call `supabase.functions.invoke('manage-push-subscription', {action:'subscribe_fcm', userId})`
  with the signed-in user's own id. I (high): supabase-js v2 `functions.invoke` sends `Authorization: Bearer <session access_token>`, which matches userId -> 200.
  `useNotifications.tsx:408/432` (`subscribe`/`unsubscribe`) are not gated.
- O grep of android-bridge-template: the only native caller is `FcmRegistrar.kt:63`. `SupabaseTaskClient.kt:165` calls execute-tool for other tools, not register_push_token.
  bridge-builder: no callers. Huddle web never stores the journey session keys (`git grep secureStore` on huddle origin/main: 0 hits), so the Huddle APK's
  `FcmRegistrar.register` returns at line 30-32. CONFIRMED.
- Old APKs (< 1.0.13) send `Bearer <anon>` -> 401 on native re-registration. That is the ONLY legitimate breakage found, and the record states it
  ("What will no longer be in place", bullet 2, plus the install-before-merge ORDER). CONFIRMED.

## C3 -- Kotlin refresh path: CONFIRMED (code read; Gradle not run here, no SDK)
- O `postWithSessionRetry` (`FcmRegistrar.kt:93-104`) makes at most 2 posts: the first post, and on 401 one refresh plus one retry. No loop. Test "401 twice does not loop".
- O a refresh failure stores nothing: `doRefreshAccessToken` returns false before any `putSync` on non-2xx or a missing refresh token, and FcmRegistrar's lambda then returns null,
  so there is no retry (test "failed refresh does not retry"). The 30s `REFRESH_SKIP` returns true and re-reads the stored token. Worst case is the same token,
  401 again, then stop.
- O signed out: `registrationBearer(null|blank|==anon)` is null -> log line + return before the Thread starts. Nothing is sent. Tests "signed out sends nothing", "anon key as stored token sends nothing".
- O CI (GitHub API): android-ci run 40551301622 @6a11b68 success, 40554062191 @894154e success, mutation probe 40572046149 @4d483e9 failure. Matches the record.
- RISK (I, medium, not tested): this makes NATIVE refresh (`/auth/v1/token?grant_type=refresh_token`) run on launch and on `onNewToken` whenever the stored access token
  has expired. Tokens sync only web -> native (`useAuth.tsx:161-165`, `App.tsx:63-70`); a natively-rotated refresh token is never handed back to the WebView. If the WebView later
  refreshes with its now-used refresh token outside GoTrue's reuse interval, the session can be revoked (SIGNED_OUT). The widget path already had this shape
  (the `refreshAccessToken` KDoc mentions 409/SIGNED_OUT), but registration now triggers it for every user on each launch with an expired stored token. Not in the record.

## C4 -- APK build: CONFIRMED with one caveat
- O `build-apk.yml`: `on: push: branches:[main], paths: configs/*/bridge.config.json`. The branch changes `configs/54beaa01-.../bridge.config.json` (`_buildTriggeredAt` only).
  Merge-base with main = f41e814 = main tip, so the merge is a clean fast-forward. versionName = `_buildNumber`(12)+1 = 1.0.13. versionCode = `github.run_number`. The config
  holds `_apkVersionCode: 162` from the previous build, so any later run is higher and installs over 1.0.12 if signed with the same `KEYSTORE_BASE64` secret (same workflow, I).
- O `claude_fcm-mutprobe-bearer` (4d483e9, still on origin) is excluded from build-apk (main only). It does trigger android-ci (branches-ignore main) and failed there as intended.
  It is a DESCENDANT of 894154e, so merging it by mistake would ship the anon-key fallback. Delete it.
- Caveat: a parallel session's `claude/laughing-tesla-kqmnhu` bumps a DIFFERENT config (8596e6c2-...), so TaskOS stays 1.0.13. The detect step takes `head -1` of the configs
  changed in HEAD~1..HEAD, so the two must land as separate pushes. As separate PRs they will.

## C5 -- my own run + mutations: CONFIRMED
- O `npm test` (node v22.22.0, clone @1656812): `# tests 324 # pass 324 # fail 0 # todo 0`.
- O mutate.sh (anchors in files):
  | mutation | must-fail test | outcome |
  |---|---|---|
  | M1 `callerIsUser` accepts the service-role key (`mintCaller(..., env SERVICE_ROLE) !== "none"`) | "subscribe_fcm: service-role key, forged JWT, key only in apikey -> 401" | FIRED, restored = HEAD |
  | M2 `bearerToken` falls back to the `apikey` header | same | FIRED, restored = HEAD |
  | M3 dedupe `.neq('user_id', userId)` -> `.neq('user_id','__nobody__')` (deletes the owner's own fresh row) | "J14 dedupe: still runs for the verified owner" | FIRED, restored = HEAD |

## C6 -- is "What will no longer be in place" complete and accurate? REFUTED (incomplete)
Accurate as far as it goes (old APKs lose background re-registration; unverified callers cannot use subscribe_fcm or the dedupe). Missing from the record:
1. C2-BYPASS2: `push_subscriptions` RLS is `FOR ALL TO public USING(true) WITH CHECK(true)` and anon holds INSERT/SELECT/UPDATE/DELETE (live). Registration is
   still possible with the anon key straight through PostgREST, and every FCM token is readable. Option A does not close C2-SEC1 while this policy stands.
2. C2-BYPASS1: Huddle's unauthenticated `invokeJourneyToolDebug` (and `registerBridgeFcmToken`) -> huddle-proxy -> service-role -> `register_push_token` registers a device
   for any user by email. The record calls huddle-proxy a trusted caller; its upstream is not.
3. A verified user can still delete another user's row via the dedupe, given that user's FCM token, and BYPASS2 exposes those tokens.
4. RISK: native refresh-token rotation on launch or `onNewToken` (C3).

## VERDICT
FAIL. The code delivered (gate, Kotlin, tests, build trigger) does what it claims, and my own mutations and run match. But the claim behind it, that the server must refuse
a registration whose login does not match the userId (closing the takeover), does not hold. Two other routes still register a device for any user without that user's login: the
table's anon-open RLS (live) and Huddle's unauthenticated debug server function. The record does not list either.
