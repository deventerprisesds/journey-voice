-- Add RLS policy to allow demo users to view EMBA assignments
create policy "Demo anon can view EMBA assignments"
on public.assignments
for select
to anon, authenticated
using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);