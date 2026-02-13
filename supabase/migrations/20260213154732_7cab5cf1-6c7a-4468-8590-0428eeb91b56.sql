-- Demo user RLS policies for task_topic_mappings
CREATE POLICY "Demo user can view topic mappings"
  ON public.task_topic_mappings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_topic_mappings.task_id
      AND tasks.user_id = '00000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Demo user can insert topic mappings"
  ON public.task_topic_mappings FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_topic_mappings.task_id
      AND tasks.user_id = '00000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Demo user can delete topic mappings"
  ON public.task_topic_mappings FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tasks
    WHERE tasks.id = task_topic_mappings.task_id
      AND tasks.user_id = '00000000-0000-0000-0000-000000000001'::uuid
  ));

-- Demo user DELETE policy for task_topic_index
CREATE POLICY "Demo user can delete topics"
  ON public.task_topic_index FOR DELETE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);