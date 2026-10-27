# VERIFY phone-registration-a — loop 2
<!--
WHAT:       independent verification of the loop-2 fixes for phone registration (BYPASS1, BYPASS2, dedupe, no native refresh)
WHY:        loop 1 (VERIFY-phone-registration-a-1.md) = FAIL with two bypasses; this re-derives every fix
SUPERSEDES: nothing (loop 1 file stays as its own record)
SUPERSEDED-BY: nothing -- current
EVIDENCE:   this file; heads journey-voice 5db8a47, huddle c043f1f, android 61c1903
-->
Started 2026-10-27 21:01 UTC. Verifier clones: journey `claude_restore-j13-alarm-actions` 5db8a47,
huddle `claude_fcm-register-with-session` c043f1f, android `claude_fcm-register-with-session` 61c1903.
Written incrementally, one verdict per commit.

## C5 (re-check) journey `npm test`
- O: `npm test` in a fresh clone at 5db8a47 → `# tests 331 # pass 331 # fail 0`, exit 0. **CONFIRMED.**

## (a) BYPASS2 — `push_subscriptions` lockdown migration (`20261027210000_push_subscriptions_rls_lockdown.sql`)
**Verdict: CONFIRMED (closes BYPASS2 once applied; NOT applied — live is still open).**

Route note: the brief's route (Supabase MCP `execute_sql` inside a DO block ending in `RAISE EXCEPTION`)
was attempted; the MCP server held it for a user confirmation that never came (60s timeout), so it did
NOT run. Substitute: a throwaway local Postgres 16 with Supabase-shaped roles (`anon`, `authenticated`,
`service_role BYPASSRLS`, `auth.uid()` = Supabase's definition, default ALL grants on public tables), the
table built from the repo's own two migrations (`20260204173114_…`, `20260621000000_…`), then the new
migration applied **verbatim with `psql -f`**.

- O (live, read-only, this loop): `pg_policies` for `public.push_subscriptions` = one row
  `Service role full access | {public} | ALL | true | true`. Live is unchanged = still vulnerable.
  Only trigger on the table: `update_push_subscriptions_updated_at`.
- O (local, BEFORE = live shape): anon SELECT saw all rows; anon INSERT of a victim row SUCCEEDED; anon
  DELETE 2 rows; anon TRUNCATE ok; user u2's JWT saw u1's rows, INSERTed for u1, UPDATEd u1's fcm_token,
  TRUNCATEd. (Reproduces loop-1 BYPASS2.)
- O (local, migration applied): parses and runs, every statement OK. Result:
  `push_subscriptions_service_role_all | {service_role} | ALL | true | true`;
  `push_subscriptions_owner_select | {authenticated} | SELECT | (user_id = (SELECT auth.uid()))`;
  grants: authenticated=SELECT only; anon=none; service_role=all.
- O (local, AFTER): anon SELECT/INSERT/DELETE/TRUNCATE → `permission denied`; u2 sees 1 row (own), 0 of
  u1's; u2 INSERT-for-u1 / UPDATE / TRUNCATE → `permission denied`; service_role INSERT/UPDATE/DELETE ok.
- O (sweep, all three repos, non-test, non-migration): the only non-service-role use is
  `journey-voice/src/hooks/useBridgeDiagnostics.ts:66` — `select('endpoint').eq('user_id', user.id)` =
  own rows, covered by the owner SELECT policy. Writers are edge functions with `SUPABASE_SERVICE_ROLE_KEY`
  (manage-push-subscription :35, send-push-notification :164, send-android-calendar-event :69,
  execute-tool :2865 client). Huddle's hits are `chat.push_subscriptions` (Azure PG, different table).
  android-bridge-template has no REST access to the table. No client breaks.
- Minor (not a blocker): the migration is NOT re-runnable — a second apply fails at line 25
  (`policy "push_subscriptions_service_role_all" … already exists`). Fine for a one-shot migration
  (Supabase applies it in one transaction); a `DROP POLICY IF EXISTS` for the two new names would make it idempotent.
- I: local Postgres is not the live project; the live table could carry extra grants the repo does not
  show. The migration's `REVOKE ALL … FROM anon` covers anon whatever it holds; a post-apply `pg_policies`
  + `has_table_privilege` read on live is the confirming step after it ships.

## (b) BYPASS1 — Huddle `registerBridgeFcmToken` / `invokeJourneyToolDebug` need a verified Entra token (huddle c043f1f)
**Verdict: CONFIRMED for both server fns. The goal is REOPENED elsewhere — see "Still open" below.**
- O: both handlers now delegate to `verified-caller.server.ts`; `verifiedJourneyCaller` returns null for a
  missing/short/non-string token, a token whose verify throws, or one without oid/email; then
  `{ok:false, error:"unauthorized"}` and the proxy is never called. Body `caller` is parsed and ignored.
- O: the verifier behind it is `src/lib/entra-verify.server.ts` `verifyEntraIdToken` = jose `jwtVerify`
  against the tenant JWKS with `audience: clientId` and `issuer` → signature, aud, iss and `exp` checked.
  Forged / expired / wrong-audience tokens throw → null.
- O: `bun scripts/journey-verified-caller.test.ts` → **12 passed, 0 failed** (no token + body victim,
  forged token, body caller ignored, wiring W-1/W-2).
- O MUTATION M1 (`mutate.sh`, anchor in file): replaced the `if (!caller) return {ok:false…}` gate in
  `registerBridgeFcmTokenImpl` with a call through to `register_push_token` → **FIRED** on
  `RB-1: no idToken`; restored = HEAD.
- O: callers — the only client caller is `HuddleView.tsx:1236-1240` (sends `getToken()`).
  `invokeJourneyToolDebug` has NO client caller in `src/` (grep), so making it require a token breaks nothing.
- I (not run on a device): inside the Android Huddle web view `getToken()` is MSAL `acquireTokenSilent`
  (`src/lib/entra-auth.ts:391-428`) of the already-signed-in Huddle web app, so a signed-in user has an ID
  token. **Residual (minor, availability):** `done = true` is set BEFORE `getToken()`; if `getToken()`
  returns null once (silent-acquire hiccup), registration is skipped for the rest of that page session
  with no retry and no log. Not a security defect.
- I: huddle-proxy forwards ANY `toolName` (`huddle-proxy/index.ts:154-206`), so any Huddle server fn that
  passes a body `caller` into `invokeJourneyTool` is a potential route. The agent path
  (`huddle.functions.ts:4634`, `caller: data.caller ?? {}`) dispatches `c.name` from the model's tool call;
  `register_push_token` appears in no tool DEFINITION in journey (`grep` finds only the execute-tool
  `case` :410 and the gate :2896), so it is not offered to agents. Not proven unreachable (dispatch does
  not re-check `c.name` against the offered set in the lines read); low likelihood.

## (c) dedupe residual (journey 2ebd641)
**Verdict: CONFIRMED.** O: `manage-push-subscription/index.ts:56-93` — gate (`callerIsUser`) first, then
`fcmToken` required, upsert, then dedupe `.eq('fcm_token', fcmToken).neq('user_id', userId)`.
O MUTATION M2: removed `.neq('user_id', userId)` → **FIRED** on
`J14 dedupe scope: a verified owner deletes ONLY other users' rows…`; restored = HEAD.
Tests at `index.auth.test.ts:73-112` include the empty-string-token refusal. Covered by the 331/331 run.

## (d) Android FcmRegistrar — no native refresh (android 448793c, head 61c1903)
**Verdict: CONFIRMED.**
- O: `register()` sends only when `supabase_user_id` is present AND `registrationBearer` returns a token:
  non-empty, ≠ anon key, readable `exp`, ≥ 60 s left (`FcmRegistrar.kt:35-46, 110-114`). Otherwise the
  token is written to `EncryptedPrefs[fcm_pending_registration]` and nothing is sent.
- O: pending is lost? No — it is in EncryptedPrefs (disk), so it survives process death / app kill; also
  re-written on HTTP non-2xx and on exception; removed only on 2xx and only if unchanged.
- O: no infinite retry — the only re-send trigger is `onSessionHandoff`, called from
  `JavascriptBridge.secureStore` when key == `supabase_user_id` and value is non-blank; one attempt per handoff.
- O: handoff order — journey `src/App.tsx:65` stores `supabase_access_token` BEFORE `:67` `supabase_user_id`
  (same in `useAuth.tsx:163/165`), so the fresh token is in place when the send fires. Sign-out (`App.tsx:69-71`)
  stores `''` → the blank check means nothing is sent signed out.
- O: CI run 40580243961 on 448793c → `check` success. Mutation run 40581185190 (4f7cd6d, expiry ignored)
  → `80 tests completed, 2 failed`: "expired session token is not sent" and "token about to expire is not
  sent". Head 61c1903 is a ledger-only commit after 448793c (not separately CI'd; I did not diff it).
- Note: `claude_fcm-mutprobe-bearer` on origin now holds a SECOND throwaway mutation commit (4f7cd6d);
  it must never be merged and still needs a manual delete.

## (e) record + C1/C4 re-check
- C1 O: web callers unchanged in shape (`App.tsx` handoff, supabase-js invoke sends the session JWT);
  Huddle path now sends an Entra token (above). C4 not re-run this loop (no APK change since loop 1 beyond
  448793c; NOT REACHED for a fresh build).
- NOT REACHED (budget): huddle `npm run test:router` and `npx tsc --noEmit` (clone has no node_modules).

## Still open — does any of it reopen "register a device for ANOTHER user"?
**YES, one item does: `manage-push-subscription` action `subscribe` (web push) still trusts `body.userId`
with no login check** (`index.ts:107-130`; function is `verify_jwt=false`, uses the service-role key, so
the RLS migration does NOT cover it). Anyone with the public anon key can POST
`{action:"subscribe", userId:<victim>, subscription:{endpoint:<their own browser's push endpoint>, keys…}}`.
`send-push-notification` then sends the victim's notifications (title + body of reminders/alarms/messages,
`webPayload`) to that endpoint (`:320-332`) — i.e. the attacker's phone browser receives the victim's
pushes. What it does NOT get: the alarm action token (FCM-only, `:262`). So: the alarm-button takeover is
closed; **notification-content delivery to another person's device is still open.** Inference from code;
not exercised live (would write to prod).
Also open, integrity not confidentiality: `unsubscribe` with `body.userId` deletes ALL of that user's rows
incl. FCM (`:164-168`) → anyone can silence another user's phone alarms until the next re-registration.
`execute-tool` other tools trusting body `userId` do not register a device (only `register_push_token`
does, and it is gated); huddle.functions body-caller sites reach journey tools but not `register_push_token`
by any offered definition (see (b)).

## VERDICT: FAIL (narrowly)
Every loop-2 fix verifies: (a) CONFIRMED, (b) CONFIRMED, (c) CONFIRMED, (d) CONFIRMED, C5 331/331, 2 own
mutations FIRED. FAIL because the goal is still reachable through web-push `subscribe` (another person's
device receives the victim's notifications) and `unsubscribe` can wipe another user's phone registration.
