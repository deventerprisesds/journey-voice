-- Drop the existing ALL policy
DROP POLICY IF EXISTS "Users can manage their own scheduling preferences" ON user_scheduling_prefs;

-- Create separate policies for each operation
CREATE POLICY "Users can view their own scheduling preferences"
  ON user_scheduling_prefs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scheduling preferences"
  ON user_scheduling_prefs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scheduling preferences"
  ON user_scheduling_prefs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scheduling preferences"
  ON user_scheduling_prefs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);