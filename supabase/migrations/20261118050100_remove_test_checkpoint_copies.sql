-- WHAT:       Remove the 4 leftover "Test-Checkpoint 2 - Details (UAT ...)" cards from the owner's board.
-- WHY:        Owner 2026-11-15: "Go ahead and delete the test copies" (approved again 2026-11-18 "Go on all").
--             They came from another session's UAT on 2026-11-05/08 and held real schedule slots.
-- SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   a full copy is saved to public._test_task_cleanup_20261118 first.
create table if not exists public._test_task_cleanup_20261118 as
  select * from public.tasks where user_id='a3378f93-d655-4913-b2fa-ca5b1d8020f1' and title like '📚 Test-Checkpoint 2 - Details (UAT %';
alter table public._test_task_cleanup_20261118 enable row level security;
delete from public.tasks where id in (select id from public._test_task_cleanup_20261118);
