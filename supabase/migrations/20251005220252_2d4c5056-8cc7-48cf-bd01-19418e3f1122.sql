-- Create user scheduling preferences table
CREATE TABLE IF NOT EXISTS public.user_scheduling_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_scheduling_prefs ENABLE ROW LEVEL SECURITY;

-- Users can manage their own scheduling preferences
CREATE POLICY "Users can manage their own scheduling preferences"
ON public.user_scheduling_prefs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_user_scheduling_prefs_updated_at
BEFORE UPDATE ON public.user_scheduling_prefs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_user_scheduling_prefs_user_id ON public.user_scheduling_prefs(user_id);