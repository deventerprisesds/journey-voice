-- Phase 1: Database Schema Transformation
-- Create comprehensive task management system

-- Create enums for better type safety
CREATE TYPE task_status AS ENUM ('BACKLOG', 'TODO', 'DOING', 'DONE');
CREATE TYPE task_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE task_category AS ENUM ('LIFE', 'CAREER', 'VENTURES', 'EDUCATION');
CREATE TYPE task_source AS ENUM ('CHAT', 'EMBA_SHEET', 'MIT_SHEET', 'MANUAL');
CREATE TYPE notification_channel AS ENUM ('WEB_PUSH', 'EMAIL', 'IN_APP');

-- Create sources table to track task origins
CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  source_type task_source NOT NULL,
  config JSONB,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

-- Create boards table for user organization
CREATE TABLE public.boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3B82F6',
  user_id UUID NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create columns table for Kanban columns
CREATE TABLE public.columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  status task_status NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create main tasks table
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'BACKLOG',
  priority task_priority NOT NULL DEFAULT 'MEDIUM',
  category task_category NOT NULL DEFAULT 'LIFE',
  due_date TIMESTAMP WITH TIME ZONE,
  estimate_minutes INTEGER,
  blocked_by UUID[] DEFAULT '{}',
  source_id UUID REFERENCES public.sources(id),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create task_columns junction table for positioning
CREATE TABLE public.task_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES public.columns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(task_id, column_id)
);

-- Create task_events for audit logging
CREATE TABLE public.task_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create notification preferences table
CREATE TABLE public.notification_prefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '08:00',
  timezone TEXT DEFAULT 'UTC',
  channels notification_channel[] DEFAULT '{WEB_PUSH, IN_APP}',
  due_reminders_enabled BOOLEAN DEFAULT true,
  overdue_reminders_enabled BOOLEAN DEFAULT true,
  daily_digest_enabled BOOLEAN DEFAULT false,
  weekly_digest_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scheduled notifications table
CREATE TABLE public.scheduled_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  delivered_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create delivery logs table
CREATE TABLE public.delivery_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES public.scheduled_notifications(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  delivered_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  response_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI threads table
CREATE TABLE public.ai_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  openai_thread_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_threads ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sources
CREATE POLICY "Users can view their own sources" ON public.sources
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own sources" ON public.sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sources" ON public.sources
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sources" ON public.sources
  FOR DELETE USING (auth.uid() = user_id);

-- Create RLS policies for boards
CREATE POLICY "Users can view their own boards" ON public.boards
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own boards" ON public.boards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own boards" ON public.boards
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own boards" ON public.boards
  FOR DELETE USING (auth.uid() = user_id);

-- Create RLS policies for columns
CREATE POLICY "Users can view columns in their boards" ON public.columns
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.boards WHERE boards.id = columns.board_id AND boards.user_id = auth.uid()
  ));
CREATE POLICY "Users can create columns in their boards" ON public.columns
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.boards WHERE boards.id = columns.board_id AND boards.user_id = auth.uid()
  ));
CREATE POLICY "Users can update columns in their boards" ON public.columns
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.boards WHERE boards.id = columns.board_id AND boards.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete columns in their boards" ON public.columns
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.boards WHERE boards.id = columns.board_id AND boards.user_id = auth.uid()
  ));

-- Create RLS policies for tasks
CREATE POLICY "Users can view their own tasks" ON public.tasks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own tasks" ON public.tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own tasks" ON public.tasks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own tasks" ON public.tasks
  FOR DELETE USING (auth.uid() = user_id);

-- Create RLS policies for task_columns
CREATE POLICY "Users can view task positions in their boards" ON public.task_columns
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.tasks t 
    JOIN public.boards b ON t.board_id = b.id 
    WHERE t.id = task_columns.task_id AND b.user_id = auth.uid()
  ));
CREATE POLICY "Users can manage task positions in their boards" ON public.task_columns
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.tasks t 
    JOIN public.boards b ON t.board_id = b.id 
    WHERE t.id = task_columns.task_id AND b.user_id = auth.uid()
  ));

-- Create RLS policies for task_events
CREATE POLICY "Users can view events for their tasks" ON public.task_events
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create events for their tasks" ON public.task_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for notification_prefs
CREATE POLICY "Users can view their own notification preferences" ON public.notification_prefs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own notification preferences" ON public.notification_prefs
  FOR ALL USING (auth.uid() = user_id);

-- Create RLS policies for scheduled_notifications
CREATE POLICY "Users can view their own scheduled notifications" ON public.scheduled_notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own scheduled notifications" ON public.scheduled_notifications
  FOR ALL USING (auth.uid() = user_id);

-- Create RLS policies for delivery_logs
CREATE POLICY "Users can view delivery logs for their notifications" ON public.delivery_logs
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.scheduled_notifications sn 
    WHERE sn.id = delivery_logs.notification_id AND sn.user_id = auth.uid()
  ));

-- Create RLS policies for ai_threads
CREATE POLICY "Users can view their own AI threads" ON public.ai_threads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own AI threads" ON public.ai_threads
  FOR ALL USING (auth.uid() = user_id);

-- Create triggers for updated_at columns
CREATE TRIGGER update_sources_updated_at
  BEFORE UPDATE ON public.sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_columns_updated_at
  BEFORE UPDATE ON public.columns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_threads_updated_at
  BEFORE UPDATE ON public.ai_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create performance indexes
CREATE INDEX idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_priority ON public.tasks(priority);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX idx_tasks_board_id ON public.tasks(board_id);
CREATE INDEX idx_boards_user_id ON public.boards(user_id);
CREATE INDEX idx_columns_board_id ON public.columns(board_id);
CREATE INDEX idx_task_columns_task_id ON public.task_columns(task_id);
CREATE INDEX idx_task_columns_column_id ON public.task_columns(column_id);
CREATE INDEX idx_scheduled_notifications_user_id ON public.scheduled_notifications(user_id);
CREATE INDEX idx_scheduled_notifications_scheduled_for ON public.scheduled_notifications(scheduled_for);
CREATE INDEX idx_task_events_task_id ON public.task_events(task_id);

-- Function to automatically create default board and columns for new users
CREATE OR REPLACE FUNCTION public.create_default_board_for_user()
RETURNS TRIGGER AS $$
DECLARE
  board_id UUID;
  col_id UUID;
BEGIN
  -- Create default board
  INSERT INTO public.boards (name, description, user_id, is_default, position)
  VALUES ('Personal Tasks', 'Your main task board', NEW.user_id, true, 0)
  RETURNING id INTO board_id;
  
  -- Create default columns
  INSERT INTO public.columns (name, board_id, status, position) VALUES
  ('Backlog', board_id, 'BACKLOG', 0),
  ('To Do', board_id, 'TODO', 1),
  ('In Progress', board_id, 'DOING', 2),
  ('Done', board_id, 'DONE', 3);
  
  -- Create default notification preferences
  INSERT INTO public.notification_prefs (user_id) VALUES (NEW.user_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log task changes
CREATE OR REPLACE FUNCTION public.log_task_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.task_events (task_id, event_type, old_values, new_values, user_id)
    VALUES (
      NEW.id,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      NEW.user_id
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_events (task_id, event_type, new_values, user_id)
    VALUES (
      NEW.id,
      'CREATE',
      to_jsonb(NEW),
      NEW.user_id
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for task change logging
CREATE TRIGGER log_task_changes_trigger
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_task_changes();