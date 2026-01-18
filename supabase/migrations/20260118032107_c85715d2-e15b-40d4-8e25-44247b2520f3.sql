-- Add demo-friendly RLS policies for chat functionality
-- These allow the hardcoded demo user ID to access chat tables

-- ai_threads: Demo user INSERT
CREATE POLICY "Demo anon can insert ai_threads"
ON ai_threads FOR INSERT
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ai_threads: Demo user SELECT
CREATE POLICY "Demo anon can view ai_threads"
ON ai_threads FOR SELECT
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ai_threads: Demo user UPDATE
CREATE POLICY "Demo anon can update ai_threads"
ON ai_threads FOR UPDATE
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- conversation_messages: Demo user INSERT
CREATE POLICY "Demo anon can insert conversation_messages"
ON conversation_messages FOR INSERT
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- conversation_messages: Demo user SELECT
CREATE POLICY "Demo anon can view conversation_messages"
ON conversation_messages FOR SELECT
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- conversation_messages: Demo user UPDATE
CREATE POLICY "Demo anon can update conversation_messages"
ON conversation_messages FOR UPDATE
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);