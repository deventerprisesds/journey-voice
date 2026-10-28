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
