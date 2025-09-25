-- Fix security warnings by setting search_path for missing functions

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix create_default_board_for_user function
CREATE OR REPLACE FUNCTION public.create_default_board_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;