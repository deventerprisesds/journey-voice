-- Add RLS policies to allow demo users to view legacy EMBA data
create policy "Demo anon can view EMBA assignments (legacy demo)"
on public.assignments
for select
to anon, authenticated
using (user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'::uuid);

create policy "Demo anon can view EMBA courses (legacy demo)"
on public.courses
for select
to anon, authenticated
using (user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'::uuid);