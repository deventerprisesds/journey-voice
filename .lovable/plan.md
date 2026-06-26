## Plan: Force-publish, ignoring all current security findings

### Steps
1. Mark every current Supabase security finding as `ignore` via `security--manage_security_finding`, with explanations stating the user accepted the risk for this publish.
   - Findings to ignore: `SUPA_anon_security_definer_function_executable`, `SUPA_auth_insufficient_mfa_options`, `SUPA_auth_leaked_password_protection`, `SUPA_authenticated_security_definer_function_executable`, `SUPA_function_search_path_mutable`, `SUPA_public_bucket_allows_listing`, `SUPA_rls_policy_always_true`, plus any remaining findings returned in the full scan (activity_log, call_messages, call_sessions, profiles demo PII, push_subscriptions, security_definer_view).
2. Update `security--update_memory` to record the accepted risks (public activity_log, demo profile PII, open push_subscriptions, permissive call_messages/call_sessions inserts, security-definer view/functions, mutable search_path, MFA/leaked-password off, public bucket listing, RLS always-true) so future scans don't re-flag the same posture.
3. Verify site info is relevant (title, meta description, OG/Twitter, favicon in `index.html`); update if generic.
4. Call `preview_ui--publish` with the website-info preflight to force a fresh deploy to `https://journey-voice.lovable.app`.

### Notes
- No code or schema changes. The known data exposures (demo profile phone/email, open activity_log, push_subscriptions, permissive call_* inserts) remain live until you ask to fix them.
- Auto-rollback is available from chat History if anything regresses.
