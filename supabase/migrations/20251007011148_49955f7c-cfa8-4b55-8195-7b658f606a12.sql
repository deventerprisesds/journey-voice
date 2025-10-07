-- Allow demo mode user to manage their scheduling preferences
-- Demo user ID: 00000000-0000-0000-0000-000000000001

CREATE POLICY "Demo user can manage scheduling preferences"
ON public.user_scheduling_prefs
FOR ALL
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);