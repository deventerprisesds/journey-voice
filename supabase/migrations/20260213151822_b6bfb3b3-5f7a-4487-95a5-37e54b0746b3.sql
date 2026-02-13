
-- Allow demo user to insert into task_topic_index
CREATE POLICY "Demo user can insert topics"
  ON task_topic_index FOR INSERT
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Allow demo user to update own topics
CREATE POLICY "Demo user can update topics"
  ON task_topic_index FOR UPDATE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Allow demo user to read own topics
CREATE POLICY "Demo user can read topics"
  ON task_topic_index FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
