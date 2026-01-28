-- Tier 1: Fix activity_log RLS - Add INSERT/UPDATE policies for authenticated users
CREATE POLICY "Users can insert their own activity"
ON activity_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own activity"
ON activity_log FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow demo user (anon role) to log
CREATE POLICY "Demo user can insert activity"
ON activity_log FOR INSERT TO anon
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update activity"
ON activity_log FOR UPDATE TO anon
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Tier 2: Create dedicated error_log table
CREATE TABLE error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL,
  component TEXT,
  session_id TEXT,
  user_id UUID,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_code TEXT,
  stack_trace TEXT,
  context JSONB DEFAULT '{}'
);

-- Enable RLS on error_log
ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

-- Permissive INSERT policy - anyone can log errors
CREATE POLICY "Anyone can insert errors"
ON error_log FOR INSERT TO public
WITH CHECK (true);

-- Users can view their own errors
CREATE POLICY "Users can view own errors"
ON error_log FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Demo user can view errors
CREATE POLICY "Demo user can view errors"
ON error_log FOR SELECT TO anon
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Tier 3: Create quick debug views
CREATE OR REPLACE VIEW recent_errors AS
SELECT 
  created_at,
  source,
  component,
  session_id,
  error_type,
  error_message,
  context
FROM error_log
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;

-- Combined debug timeline (replaces existing debug_timeline)
CREATE OR REPLACE VIEW debug_timeline_full AS
SELECT 
  created_at as timestamp,
  'activity' as log_type,
  activity_type as source,
  session_id,
  status,
  stage,
  error_message,
  metadata::text as context,
  user_id
FROM activity_log
WHERE created_at > now() - interval '24 hours'
UNION ALL
SELECT 
  created_at as timestamp,
  'error' as log_type,
  source,
  session_id,
  error_type as status,
  component as stage,
  error_message,
  context::text,
  user_id
FROM error_log
WHERE created_at > now() - interval '24 hours'
ORDER BY timestamp DESC
LIMIT 100;