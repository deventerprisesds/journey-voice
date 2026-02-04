-- Drop all existing policies first, then recreate properly
DROP POLICY IF EXISTS "Users can update own presence" ON public.user_presence;
DROP POLICY IF EXISTS "Service role can read presence" ON public.user_presence;
DROP POLICY IF EXISTS "Users can manage own presence" ON public.user_presence;
DROP POLICY IF EXISTS "Service role can read all presence" ON public.user_presence;

-- Users can manage their own presence (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Users can manage own presence"
  ON public.user_presence
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can read all presence for edge functions
CREATE POLICY "Service role can read all presence"
  ON public.user_presence
  FOR SELECT
  USING (auth.role() = 'service_role');