-- Fix RLS policies for sync_config table only

-- Drop existing policy on sync_config
DROP POLICY IF EXISTS "Users can manage their own sync config" ON public.sync_config;

-- Create proper RLS policies for sync_config with separate permissions
CREATE POLICY "Users can view their own sync config"
  ON public.sync_config
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync config"
  ON public.sync_config
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync config"
  ON public.sync_config
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sync config"
  ON public.sync_config
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add missing policies for sync_logs
CREATE POLICY "Users can insert their own sync logs"
  ON public.sync_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync logs"
  ON public.sync_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);