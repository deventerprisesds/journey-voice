-- Fix user_presence RLS policies to allow initial insert via upsert
-- The current INSERT + ALL policies conflict on upsert for new rows

-- Drop all existing user policies (keep service role policy)
DROP POLICY IF EXISTS "Users can insert own presence" ON user_presence;
DROP POLICY IF EXISTS "Users can manage own presence" ON user_presence;
DROP POLICY IF EXISTS "Users can view own presence" ON user_presence;
DROP POLICY IF EXISTS "Users can update own presence" ON user_presence;

-- Create a single unified policy for all operations
CREATE POLICY "Users can manage own presence"
  ON user_presence
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);