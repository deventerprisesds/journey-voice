ALTER TABLE public.task_topic_index
ADD COLUMN parent_topic_id UUID REFERENCES public.task_topic_index(id) ON DELETE SET NULL;