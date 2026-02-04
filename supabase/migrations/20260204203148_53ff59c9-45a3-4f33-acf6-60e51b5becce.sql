-- Create user_presence table for tracking active chat presence
CREATE TABLE public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  active_context TEXT DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Users can view and update their own presence
CREATE POLICY "Users can view own presence"
  ON public.user_presence FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own presence"
  ON public.user_presence FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own presence"
  ON public.user_presence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow service role to read presence for conditional push notifications
CREATE POLICY "Service role can read all presence"
  ON public.user_presence FOR SELECT
  TO service_role
  USING (true);

-- Auto-update updated_at
CREATE TRIGGER update_user_presence_updated_at
  BEFORE UPDATE ON public.user_presence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE public.user_presence IS 'Tracks user activity state for conditional push notifications (Slack/SMS-like behavior)';