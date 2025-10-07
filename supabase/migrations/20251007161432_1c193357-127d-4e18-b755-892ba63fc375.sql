-- Create assignments_mit table (mirror of assignments)
CREATE TABLE public.assignments_mit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'assignment',
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TIMESTAMPTZ,
  points INTEGER,
  feedback TEXT,
  sheet_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.assignments_mit ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can manage their own MIT assignments
CREATE POLICY "Users can manage their own MIT assignments"
  ON public.assignments_mit
  FOR ALL
  USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_assignments_mit_updated_at
  BEFORE UPDATE ON public.assignments_mit
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Performance indexes
CREATE INDEX idx_assignments_mit_user_id ON public.assignments_mit(user_id);
CREATE INDEX idx_assignments_mit_due_date ON public.assignments_mit(due_date);
CREATE INDEX idx_assignments_mit_course_id ON public.assignments_mit(course_id);

-- Create assignments_mit_history table (for tracking changes)
CREATE TABLE public.assignments_mit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments_mit(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assignments_mit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own MIT assignment history"
  ON public.assignments_mit_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_assignments_mit_history_user_id ON public.assignments_mit_history(user_id);
CREATE INDEX idx_assignments_mit_history_assignment_id ON public.assignments_mit_history(assignment_id);