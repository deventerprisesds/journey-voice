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
