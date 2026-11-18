-- WHAT:       Merge the von.ellis@ Google sign-in into the owner's main TaskOS account (a3378f93, dev@) and
--             remove the empty duplicate account (4132de9e) it created on 2026-08-01.
-- WHY:        Owner 2026-11-18: "Take the same approach as huddle for both emails being the same user
--             account". Huddle already maps von.ellis@ -> a3378f93 via public.user_email_aliases; TaskOS sign-in
--             never read that table, so a Google sign-in as von.ellis@ landed in an empty account.
-- SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   the duplicate holds only defaults (empty board, default assistant, empty thread, run logs; 0
--             tasks). A full copy is saved to public._acct_merge_backup_20261118 before anything is removed.
-- Idempotent: every statement is keyed on the duplicate's id; re-running after success changes nothing.
create table if not exists public._acct_merge_backup_20261118 as
  select 'auth.users'::text src, to_jsonb(u) row from auth.users u where id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'auth.identities', to_jsonb(i) from auth.identities i where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'boards', to_jsonb(b) from public.boards b where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'ai_threads', to_jsonb(t) from public.ai_threads t where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'assistants', to_jsonb(a) from public.assistants a where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'user_scheduling_prefs', to_jsonb(p) from public.user_scheduling_prefs p where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78'
  union all select 'notification_prefs', to_jsonb(n) from public.notification_prefs n where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
alter table public._acct_merge_backup_20261118 enable row level security;
update auth.identities set user_id='a3378f93-d655-4913-b2fa-ca5b1d8020f1', updated_at=now()
  where provider='google' and provider_id='116120397069032567957' and user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.ai_threads where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.assistants where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.boards where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.user_scheduling_prefs where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.notification_prefs where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from public.activity_log where user_id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
delete from auth.users where id='4132de9e-e0ef-40c2-bbc3-c9a131c9ef78';
