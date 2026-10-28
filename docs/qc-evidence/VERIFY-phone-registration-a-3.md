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

## Mutations (own, `mutate.sh`, anchors in files, test cmd `npm test`) — 4/4 FIRED, each restored = HEAD, tree clean
- M1 `manage-push-subscription/index.ts:61` gate narrowed to `action === 'subscribe_fcm' && !callerIsUser(...)`
  → **FIRED** `unsubscribe: another user`.
- M2 `_shared/push-auth.ts:79` `callerIsUser` admits the service-role key and any non-"none" caller
  → **FIRED** `subscribe (web push): another user`.
- M3 unsubscribe delete filter `.eq('user_id', userId)` → `.neq('user_id', '')` (delete everyone)
  → **FIRED** `unsubscribe: the user's own JWT removes only their own rows`.
- M4 migration: delete `DROP POLICY IF EXISTS "push_subscriptions_owner_select"` → **FIRED**
  `push_subscriptions RLS migration is re-runnable`.

## Budget reached — NOT REACHED this loop
Wall clock 19:22 UTC against a 16:50 start (45-min budget). Most of that time went in gaps between tool
calls, not test runs. Per the brief, everything below is **NOT REACHED** (not verified, not refuted):
- Huddle `0098e0b` registration retry (`bridge-fcm-register.ts`): code read, `npx tsc --noEmit -p .`,
  `npm run test:router` (20), `test:journey-verified-caller` (12), `test:bridge-fcm-register` (12).
- (b) Huddle verified caller re-check at reduced depth; (c)/(d) diff re-read at huddle/android heads;
  Android CI runs 40580243961 / 40581185190.
- **The explicit YES/NO question**: can any remaining route (huddle.functions.ts:201 → invokeJourneyTool
  :720/:1594/:2875/:3083/:3796; unauthenticated execute-tool `register_push_token`; any direct write to
  `push_subscriptions`) register or delete another user's devices? **Undecided.** Note from the evidence
  already gathered: `push_subscriptions` is still open on LIVE (loop 2 read live `pg_policies`; this loop
  did not apply the migration), so until it ships the anon-key table route is still a YES on the live
  project, whatever the edge functions do.
- Residual surfaced, not chased: the J14 dedupe lets a VERIFIED user who knows another user's exact FCM
  token delete that user's row for it by registering the token as their own (`index.ts:92-96`). It needs the
  victim's token. It is the documented "dedupe residual" and was not re-scoped here.

## Verdict (loop 3, partial)
**What was reached passes; the loop as a whole is INCOMPLETE.** CONFIRMED: C5 (337/337, probe files 3/3 and
15/15), (a) migration re-runnable (applied 3x locally) and locking down correctly, R1 gate on every
manage-push action (8 own bypass probes plus the supabase-js 2.110.0 source read), 4/4 mutations FIRED.
REFUTED: none. NOT REACHED: the Huddle retry fix, the (b)-(d) re-checks, Android CI, and the cross-user
route YES/NO.

---
# Loop 3 continuation (coordinator-directed, fresh 40-min budget from 19:26 UTC) — the NOT REACHED items

## (R2) Can any remaining route register a device for ANOTHER user, assuming the migration is APPLIED?
**Verdict: YES (REFUTED: the goal "no route registers a device for another user" does not hold).**
The path is the Huddle VOICE tool executor. It is not one of the five text-path call sites the builder listed:
1. `huddle-extension-app/src/features/huddle/lib/voice/realtime.functions.ts:182-214` `runRealtimeTool` =
   `createServerFn({method:"POST"})`, client-callable, **no auth**. Its input validator takes `name`
   (any string), `args`, `agentId` (must be any valid agent id), and `caller` **straight from the body**
   (`r.caller && typeof r.caller === "object" ? r.caller : {}`). No Entra token is read. The only global
   middleware is `src/start.ts:5` `errorMiddleware`, which handles errors, not auth.
2. → `voice/realtime-tools.server.ts:458` `executeRealtimeTool(name, args, ctx)`. `register_push_token`
   is not in `NATIVE` (:493), so it reaches `if (!NATIVE.has(name))` (:~820). That branch calls
   `invokeJourneyTool({ toolName: name, args, caller: ctx.caller ?? {} })`, and the comment there says it
   routes "to the journey catalog directly". **Unlike the text agent path, it never checks `name`
   against the offered set** (the text path at `huddle.functions.ts:4621` does: `journeyNames.has(c.name)`,
   built from the journey definitions minus `HIDDEN_FROM_HUDDLE`).
3. → `journey/proxy.functions.ts:107` `invokeJourneyTool` POSTs `/tool` to huddle-proxy using Huddle's
   server-held `JOURNEY_PROXY_TOKEN`.
4. → journey `supabase/functions/huddle-proxy/index.ts:154-206` passes any `toolName` through.
   `resolveUserId` (:92-125) maps `caller.entra_email` to a user id via the alias table, then
   `profiles.email` (case-insensitive). **Knowing the victim's email is enough.** It then calls
   execute-tool with `Authorization: Bearer ${SUPABASE_SERVICE_KEY}` (:198-206).
5. → `execute-tool/index.ts:2896`. The `register_push_token` gate lets `service_role` through **by design**
   ("huddle-proxy … resolves the user server-side"), so → `:410` → `registerPushToken` (:2041-2064) upserts
   `push_subscriptions {user_id: <victim>, fcm_token: <attacker's token>}` with the service-role client.
   **RLS and the new migration do not apply; service_role bypasses them.** If `args.app` is omitted, the
   endpoint is `fcm:<token>` (journey-native pushes, which include task-start alarms). With `app:"huddle"`
   it is `fcm:app:huddle:<token>` (Huddle reminders, alarms and reply pushes).
- So: one anonymous POST to the deployed SWA `/_serverFn/<runRealtimeTool id>` with
  `{name:"register_push_token", args:{fcm_token:"<attacker phone>"}, agentId:"<any agent>",
  caller:{entra_email:"<victim>"}}` adds the attacker's phone to the victim's push/alarm targets. This is the
  same shape as loop 1's BYPASS1 (`invokeJourneyToolDebug`), reached through a different server fn.
- O: this is a static trace of the source at huddle 0098e0b and journey c18739d. **I did not call it live.**
- **Delete another user's devices: NO route found.** Under service-role clients, the only deletes on
  `push_subscriptions` are: manage-push unsubscribe (now gated); the J14 dedupe (gated; needs the victim's
  exact token, the documented residual); send-push-notification :305/:338 (prunes rows whose delivery
  returned 404/410, i.e. not caller-chosen). `registerPushToken` only upserts under the resolved user.
  `grep push_subscriptions supabase/functions` (non-test) lists no other writer.
- Other text-path call sites listed in the brief (`huddle.functions.ts:720/1594/2875/3083/3796/3957/5211/5338`,
  `7616`): every one has a **literal** `toolName` (`update_task`, `quick_create_task`,
  `parse_and_create_tasks`, `send_push`), so none can be `register_push_token`. Those using body `caller`
  still act as a body-chosen user for task tools; that is outside this claim (registration).
  `:4634` / `:6176` dispatch `c.name` / `def.name` only from journey `/definitions` (`journeyNames` / `cached.defs`).
  `register_push_token` is `case`-only in execute-tool ("Not advertised to LLMs", :409), so it cannot be offered there.
- Implied fix: route `runRealtimeTool` through the verified caller as well, and/or allow-list the voice
  fallthrough to the offered toolset. Recorded as a finding, not designed here.
