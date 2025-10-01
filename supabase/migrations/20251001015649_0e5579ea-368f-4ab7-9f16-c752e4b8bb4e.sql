-- Create task_checklist_items table
CREATE TABLE public.task_checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;

-- Create policies for checklist items
CREATE POLICY "Users can view checklist items for their own tasks"
ON public.task_checklist_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_checklist_items.task_id
    AND tasks.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create checklist items for their own tasks"
ON public.task_checklist_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_checklist_items.task_id
    AND tasks.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update checklist items for their own tasks"
ON public.task_checklist_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_checklist_items.task_id
    AND tasks.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete checklist items for their own tasks"
ON public.task_checklist_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_checklist_items.task_id
    AND tasks.user_id = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_task_checklist_items_updated_at
BEFORE UPDATE ON public.task_checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for better query performance
CREATE INDEX idx_task_checklist_items_task_id ON public.task_checklist_items(task_id);
CREATE INDEX idx_task_checklist_items_position ON public.task_checklist_items(task_id, position);