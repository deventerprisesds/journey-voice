-- Add calendar connections table for external calendar integrations
CREATE TABLE public.calendar_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'office365')),
  provider_account_id TEXT NOT NULL,
  provider_account_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, provider_account_id)
);

-- Add external calendar events cache table
CREATE TABLE public.external_calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  calendar_id TEXT NOT NULL,
  last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_event_id)
);

-- Add start_time and end_time to tasks table
ALTER TABLE public.tasks 
ADD COLUMN start_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN end_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN external_event_id TEXT,
ADD COLUMN is_scheduled BOOLEAN NOT NULL DEFAULT false;

-- Enable RLS on new tables
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for calendar_connections
CREATE POLICY "Users can view their own calendar connections"
ON public.calendar_connections
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own calendar connections"
ON public.calendar_connections
FOR ALL
USING (auth.uid() = user_id);

-- RLS policies for external_calendar_events
CREATE POLICY "Users can view their own external calendar events"
ON public.external_calendar_events
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own external calendar events"
ON public.external_calendar_events
FOR ALL
USING (auth.uid() = user_id);

-- Add indexes for performance
CREATE INDEX idx_calendar_connections_user_provider ON calendar_connections(user_id, provider);
CREATE INDEX idx_external_events_user_time ON external_calendar_events(user_id, start_time, end_time);
CREATE INDEX idx_tasks_scheduled_time ON tasks(user_id, start_time, end_time) WHERE is_scheduled = true;

-- Add trigger for updating timestamps
CREATE TRIGGER update_calendar_connections_updated_at
BEFORE UPDATE ON public.calendar_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_external_calendar_events_updated_at
BEFORE UPDATE ON public.external_calendar_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();