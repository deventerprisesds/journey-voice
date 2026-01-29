-- Boards table: Demo mode policies
CREATE POLICY "Demo user can view boards"
  ON boards
  FOR SELECT
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can insert boards"
  ON boards
  FOR INSERT
  TO public
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update boards"
  ON boards
  FOR UPDATE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can delete boards"
  ON boards
  FOR DELETE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Tasks table: Demo mode policies
CREATE POLICY "Demo user can view tasks"
  ON tasks
  FOR SELECT
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can insert tasks"
  ON tasks
  FOR INSERT
  TO public
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update tasks"
  ON tasks
  FOR UPDATE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can delete tasks"
  ON tasks
  FOR DELETE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);