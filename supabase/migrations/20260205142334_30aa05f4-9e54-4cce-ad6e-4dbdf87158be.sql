-- =============================================================
-- Phase 1: Task Topic Index Tables for Dynamic Subject Groupings
-- =============================================================

-- Topic definitions (auto-generated from task patterns)
CREATE TABLE public.task_topic_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  topic_name TEXT NOT NULL,
  topic_summary TEXT,
  window_affinity TEXT[] DEFAULT '{}', -- ['morning', 'business_hours', 'after_work', 'evening', 'weekends']
  example_tasks TEXT[] DEFAULT '{}',
  task_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, topic_name)
);

-- Task-to-topic mappings (many-to-many)
CREATE TABLE public.task_topic_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  topic_id UUID REFERENCES public.task_topic_index(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, topic_id)
);

-- Enable RLS
ALTER TABLE public.task_topic_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_topic_mappings ENABLE ROW LEVEL SECURITY;

-- RLS policies for task_topic_index
CREATE POLICY "Users can view own topics" ON public.task_topic_index
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own topics" ON public.task_topic_index
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own topics" ON public.task_topic_index
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own topics" ON public.task_topic_index
  FOR DELETE USING (user_id = auth.uid());

-- Service role bypass for edge function operations
CREATE POLICY "Service role can manage all topics" ON public.task_topic_index
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- RLS policies for task_topic_mappings
CREATE POLICY "Users can view own topic mappings" ON public.task_topic_mappings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_topic_mappings.task_id AND tasks.user_id = auth.uid())
  );

CREATE POLICY "Users can insert own topic mappings" ON public.task_topic_mappings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_topic_mappings.task_id AND tasks.user_id = auth.uid())
  );

CREATE POLICY "Users can delete own topic mappings" ON public.task_topic_mappings
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = task_topic_mappings.task_id AND tasks.user_id = auth.uid())
  );

-- Service role bypass for edge function operations
CREATE POLICY "Service role can manage all topic mappings" ON public.task_topic_mappings
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Indexes for performance
CREATE INDEX idx_task_topic_index_user_id ON public.task_topic_index(user_id);
CREATE INDEX idx_task_topic_index_window_affinity ON public.task_topic_index USING GIN(window_affinity);
CREATE INDEX idx_task_topic_mappings_task_id ON public.task_topic_mappings(task_id);
CREATE INDEX idx_task_topic_mappings_topic_id ON public.task_topic_mappings(topic_id);

-- =============================================================
-- Phase 2: Reactive Trigger for Topic Classification
-- =============================================================

-- Function to handle topic cleanup when tasks are deleted
CREATE OR REPLACE FUNCTION public.cleanup_task_topic_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Decrement count on related topics
  UPDATE public.task_topic_index
  SET task_count = task_count - 1,
      updated_at = now()
  WHERE id IN (
    SELECT topic_id FROM public.task_topic_mappings WHERE task_id = OLD.id
  );
  
  -- Delete topics with zero or fewer tasks
  DELETE FROM public.task_topic_index WHERE task_count <= 0;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for task deletion cleanup
CREATE TRIGGER task_topic_cleanup_trigger
  AFTER DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_task_topic_on_delete();

-- Function to notify edge function for topic classification (using pg_net)
CREATE OR REPLACE FUNCTION public.notify_task_topic_classification()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Skip test tasks and blocked tasks
  IF NEW.title ILIKE '%test%' OR NEW.status = 'BLOCKED' THEN
    RETURN NEW;
  END IF;
  
  -- Get configuration from app settings
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  
  -- If settings not available, skip silently (edge function can be called manually)
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'Topic classification skipped: app.settings not configured';
    RETURN NEW;
  END IF;
  
  -- Use pg_net to call edge function asynchronously
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/classify-task-topic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'task_id', NEW.id,
      'task_title', NEW.title,
      'task_category', NEW.category,
      'user_id', NEW.user_id,
      'operation', TG_OP
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the task operation if classification fails
  RAISE WARNING 'Topic classification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for task insert/update to classify topics
CREATE TRIGGER task_topic_classification_trigger
  AFTER INSERT OR UPDATE OF title, category, status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_topic_classification();