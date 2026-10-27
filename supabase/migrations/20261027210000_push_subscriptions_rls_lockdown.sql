-- WHAT:       locks public.push_subscriptions (every user's web-push + FCM device tokens) to its real users.
-- WHY:        VERIFY-phone-registration-a-1 C2-BYPASS2, observed live 2026-10-27 on wwxgajrtmslzklnyplah:
--             the only policy, "Service role full access", had no TO clause, so it was
--             FOR ALL TO public USING (true) WITH CHECK (true); anon and authenticated also held
--             INSERT/SELECT/UPDATE/DELETE/TRUNCATE. With the public anon key anyone could read every FCM
--             token and insert a row pointing another user's alarms at their own phone, without going
--             through manage-push-subscription's new login check (Option A).
-- WHO USES IT (grep 2026-10-27, journey-voice + huddle-extension-app + android-bridge-template):
--             edge functions manage-push-subscription, send-push-notification, send-android-calendar-event,
--             execute-tool -- all with the SERVICE-ROLE key (bypasses RLS; kept explicit below).
--             The only client use is src/hooks/useBridgeDiagnostics.ts:66: SELECT endpoint of the signed-in
--             user's OWN rows -> covered by the owner SELECT policy. No client inserts, updates or deletes.
--             Huddle's chat.push_subscriptions is a different table in Huddle's own Azure Postgres.
--             No view or SQL function references this table (live pg_views / pg_proc check, 2026-10-27).
-- SUPERSEDES: the "Service role full access" policy from 20260204173114_20a8b2c1-...sql.
-- SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   docs/qc-evidence/VERIFY-phone-registration-a-1.md (C2-BYPASS2);
--             docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Loop 2 fixes").

DROP POLICY IF EXISTS "Service role full access" ON public.push_subscriptions;
-- Re-runnable: drop this migration's own policies too, so a second apply does not fail on CREATE POLICY.
DROP POLICY IF EXISTS "push_subscriptions_service_role_all" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_owner_select" ON public.push_subscriptions;

-- Edge functions (service-role key). service_role has BYPASSRLS already; the policy states the intent.
CREATE POLICY "push_subscriptions_service_role_all"
  ON public.push_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- A signed-in user may READ only their own device rows (useBridgeDiagnostics). Registration and removal go
-- through manage-push-subscription, which checks the caller's login; no client writes the table directly.
CREATE POLICY "push_subscriptions_owner_select"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Table privileges: RLS does not govern TRUNCATE, so it must be revoked. anon needs nothing at all;
-- authenticated keeps SELECT only (its rows are then filtered by the owner policy above).
REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.push_subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.push_subscriptions TO authenticated;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
