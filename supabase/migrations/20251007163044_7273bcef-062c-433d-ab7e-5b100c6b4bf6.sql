-- Demo-mode RLS allowances for preview (anon role) scoped strictly to the demo user

-- sync_config policies for anon
DROP POLICY IF EXISTS "Demo anon can view sync config" ON public.sync_config;
DROP POLICY IF EXISTS "Demo anon can insert sync config" ON public.sync_config;
DROP POLICY IF EXISTS "Demo anon can update sync config" ON public.sync_config;

CREATE POLICY "Demo anon can view sync config"
  ON public.sync_config
  FOR SELECT
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can insert sync config"
  ON public.sync_config
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can update sync config"
  ON public.sync_config
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- sync_logs policies for anon
DROP POLICY IF EXISTS "Demo anon can view sync logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Demo anon can insert sync logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Demo anon can update sync logs" ON public.sync_logs;

CREATE POLICY "Demo anon can view sync logs"
  ON public.sync_logs
  FOR SELECT
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can insert sync logs"
  ON public.sync_logs
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can update sync logs"
  ON public.sync_logs
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- courses policies for anon
DROP POLICY IF EXISTS "Demo anon can view courses" ON public.courses;
DROP POLICY IF EXISTS "Demo anon can insert courses" ON public.courses;
DROP POLICY IF EXISTS "Demo anon can update courses" ON public.courses;

CREATE POLICY "Demo anon can view courses"
  ON public.courses
  FOR SELECT
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can insert courses"
  ON public.courses
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can update courses"
  ON public.courses
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- assignments_mit policies for anon
DROP POLICY IF EXISTS "Demo anon can view MIT assignments" ON public.assignments_mit;
DROP POLICY IF EXISTS "Demo anon can insert MIT assignments" ON public.assignments_mit;
DROP POLICY IF EXISTS "Demo anon can update MIT assignments" ON public.assignments_mit;

CREATE POLICY "Demo anon can view MIT assignments"
  ON public.assignments_mit
  FOR SELECT
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can insert MIT assignments"
  ON public.assignments_mit
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo anon can update MIT assignments"
  ON public.assignments_mit
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);