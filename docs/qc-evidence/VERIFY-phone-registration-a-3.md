# VERIFY phone-registration-a — loop 3
<!--
WHAT:       independent verification of the loop-3 fixes (manage-push gate on every action, re-runnable migration, Huddle registration retry)
WHY:        loop 2 (VERIFY-phone-registration-a-2.md) = FAIL: web-push subscribe/unsubscribe trusted body.userId
SUPERSEDES: nothing (loop 1/2 files stay as their own record)
SUPERSEDED-BY: nothing -- current
EVIDENCE:   this file; heads journey-voice c18739d, huddle 0098e0b, android 61c1903
-->
Started 2026-10-28 16:50 UTC. Verifier clones: journey `claude_restore-j13-alarm-actions` c18739d,
huddle `claude_fcm-register-with-session` 0098e0b, android `claude_fcm-register-with-session` 61c1903.
Written incrementally, one verdict per commit.

## C5 (re-check) journey `npm test` + probe files
- O: `npm test` in a fresh clone at c18739d → `# tests 337 # pass 337 # fail 0`, exit 0. Output includes
  the 5 new subscribe/unsubscribe/unknown-action tests and the "migration is re-runnable" test.
- O: `docs/qc-evidence/probes/push-auth.probe.test.ts` → 3/3 pass; `alarm-action.probe.test.ts` → 15/15 pass.
- **CONFIRMED.**

## (a) `push_subscriptions` lockdown migration, re-runnable version (journey e64431f)
**Verdict: CONFIRMED (re-runnable; closes the anon/other-user table route once applied; NOT applied by this loop).**
- Route: throwaway local Postgres 16.15 (port 55433, not committed, not live) with Supabase-shaped roles
  (`anon`, `authenticated`, `service_role BYPASSRLS`, `auth.uid()` from `request.jwt.claims.sub`, default ALL
  grants on public tables), table built from the repo's own `20260204173114_…` + `20260621000000_…`, two rows
  (u1, u2). Before: one policy `Service role full access | {public} | ALL` (= the loop-1 live shape).
- O: `20261027210000_push_subscriptions_rls_lockdown.sql` applied verbatim with `psql -v ON_ERROR_STOP=1 -f`
  **twice** → both `rc=0` (first apply: NOTICE "does not exist, skipping" for the two new names; second apply:
  NOTICE for the old name, all three DROPs then both CREATEs succeed). A **third** apply as one transaction
  (`psql -1`) → `rc=0`. Policy count after all three = 2.
- O (after): `push_subscriptions_owner_select | {authenticated} | SELECT | (user_id = (SELECT auth.uid()))`;
  `push_subscriptions_service_role_all | {service_role} | ALL | true | true`; grants authenticated=SELECT,
  anon=none, service_role=all; `relrowsecurity = t`.
- O (behaviour): anon SELECT / INSERT-for-u1 / DELETE / TRUNCATE → `permission denied`; u2 (JWT sub) sees 1
  row = its own; u2 INSERT-for-u1 / UPDATE / DELETE / TRUNCATE → `permission denied`; service_role
  INSERT / UPDATE / DELETE → ok.
- I: local PG is not the live project; the confirming step after ship is a live `pg_policies` +
  `has_table_privilege` read.

## (R1) manage-push `subscribe` / `unsubscribe` / unknown action now gated (journey 35e3d89) — FULL RE-DERIVATION
**Verdict: CONFIRMED.**
- O (code, `supabase/functions/manage-push-subscription/index.ts` at c18739d): order is `req.json()` (:39) →
  `if (!userId) 400` (:42) → `if (!(await callerIsUser(req, client, userId))) 401` (:61) → only THEN the
  `subscribe_fcm` (:68) / `subscribe` (:111) / `unsubscribe` (:171) branches / `Invalid action` 400 (:211).
  No read or write precedes :61. `callerIsUser` (`_shared/push-auth.ts:78`) = `mintCaller(..., serviceKey "")`
  === `"owner_jwt"`: bearer parsed by `/^Bearer\s+(\S+)\s*$/i`; empty serviceKey makes the service-role
  branch unreachable; `typeof userId !== "string"` → none; `auth.getUser(tok)` must return no error and
  `user.id === userId` (strict). Any throw → none.
- O (own probe, real handler under the repo harness, scratch file not committed — 8/8 pass):
  V3-1 Z's valid JWT acting on X via variant spellings of X (UPPER-case, leading/trailing space, trailing
  `\n`, `[X]`, `{id:X}`, dashes stripped) × every action (subscribe, unsubscribe, subscribe_fcm, missing
  action, unknown action) → all 401, zero writes. V3-2 owner's own JWT with UPPER/space variant of its own
  id → 401 (strict, no normalisation; legit callers send `user.id` verbatim). V3-3 expired/unknown JWT,
  `Bearer` with no token, `Bearer  `, `Basic <jwt>`, `Bearer <jwt> extra`, service-role key, anon key, no
  header × every action → all 401, zero writes. V3-4 owner JWT + missing / unknown / `SUBSCRIBE` action →
  400 `Invalid action`, zero writes. V3-5 missing userId → 400 before any `getUser`. V3-6 lowercase
  `bearer` + owner JWT → 200 for own id, 401 for another id. V3-7 owner unsubscribe = exactly one delete,
  filters `[['eq','user_id',X]]`, Z's rows survive. V3-8 non-JSON body → 500, zero writes.
  (First run used an all-digit test UUID so UPPER-case was a no-op; re-run with a hex-letter UUID — noted
  so the 8/8 is not over-read.)
- O (repo suite): the 5 new handler tests in `index.auth.test.ts` (:121-160) pass inside the 337/337.
- O (legitimate callers send the session JWT — read from the PACKAGE SOURCE, @supabase/supabase-js 2.110.0 =
  the lockfile version, via `npm pack`): `get functions()` builds `FunctionsClient(url, {headers: this.headers,
  customFetch: this.fetch})` (dist/index.mjs:693-697); `this.fetch = fetchWithAuth(...)` (:673) sets
  `Authorization: Bearer ${await getAccessToken() ?? supabaseKey}` only when no Authorization header is
  already present (:340-343); `_getAccessToken` = `auth.getSession().session.access_token`, else the anon
  key (:806-811). functions-js 2.110.0 `invoke` merges `_headers`, `this.headers`, call headers then calls
  `this.fetch` (dist/module/FunctionsClient.js:249-255). journey's `src/integrations/supabase/client.ts` sets
  no `global.headers` / `accessToken` (grep empty), so nothing pre-empts the session JWT.
  Callers: `useNotifications.tsx:82` (subscribe_fcm, guarded `if (!user …)`, `userId: user.id`), `:408`
  (subscribe, `if (!user)`, `user.id`), `:432` (unsubscribe, `if (!user)`, `user.id`);
  `bridgeFcmRegistration.ts:41` called from `App.tsx:62` with `session.user.id`. All four send the signed-in
  user's own access token and their own id → pass the gate.
- I (minor, availability, not security): `functions.invoke` RETURNS `{error}` on a non-2xx rather than
  throwing, so `bridgeFcmRegistration.ts:41` marks the token `done` even on a 401 (no retry until next app
  open), and `useNotifications.tsx:82` sets `subscription` even on a 401. Only bites if the session token is
  missing/expired at that instant (then getSession refreshes; anon-key fallback → 401).
