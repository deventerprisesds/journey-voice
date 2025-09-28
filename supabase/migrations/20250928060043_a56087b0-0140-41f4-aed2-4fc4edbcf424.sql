-- Fix security vulnerabilities in profiles and audit tables

-- 1. Drop existing permissive policies for profiles table that allow public access
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- 2. Create new restrictive policies that only allow authenticated users
CREATE POLICY "Authenticated users can view their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert their own profile" 
ON public.profiles 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 3. Fix audit log security issue - restrict INSERT to service_role only
DROP POLICY IF EXISTS "System can insert access logs" ON public.profile_access_log;

CREATE POLICY "Only system functions can insert access logs" 
ON public.profile_access_log 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- 4. Update other sensitive tables to restrict to authenticated users only
-- Update boards policies
DROP POLICY IF EXISTS "Users can view their own boards" ON public.boards;
DROP POLICY IF EXISTS "Users can create their own boards" ON public.boards;
DROP POLICY IF EXISTS "Users can update their own boards" ON public.boards;
DROP POLICY IF EXISTS "Users can delete their own boards" ON public.boards;

CREATE POLICY "Authenticated users can view their own boards" 
ON public.boards 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can create their own boards" 
ON public.boards 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own boards" 
ON public.boards 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can delete their own boards" 
ON public.boards 
FOR DELETE 
TO authenticated
USING (auth.uid() = user_id);

-- 5. Update tasks policies
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can create their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;

CREATE POLICY "Authenticated users can view their own tasks" 
ON public.tasks 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can create their own tasks" 
ON public.tasks 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own tasks" 
ON public.tasks 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can delete their own tasks" 
ON public.tasks 
FOR DELETE 
TO authenticated
USING (auth.uid() = user_id);

-- 6. Update columns policies to be more secure
DROP POLICY IF EXISTS "Users can view columns in their boards" ON public.columns;
DROP POLICY IF EXISTS "Users can create columns in their boards" ON public.columns;
DROP POLICY IF EXISTS "Users can update columns in their boards" ON public.columns;  
DROP POLICY IF EXISTS "Users can delete columns in their boards" ON public.columns;

CREATE POLICY "Authenticated users can view columns in their boards" 
ON public.columns 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.boards 
  WHERE boards.id = columns.board_id 
  AND boards.user_id = auth.uid()
));

CREATE POLICY "Authenticated users can create columns in their boards" 
ON public.columns 
FOR INSERT 
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.boards 
  WHERE boards.id = columns.board_id 
  AND boards.user_id = auth.uid()
));

CREATE POLICY "Authenticated users can update columns in their boards" 
ON public.columns 
FOR UPDATE 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.boards 
  WHERE boards.id = columns.board_id 
  AND boards.user_id = auth.uid()
));

CREATE POLICY "Authenticated users can delete columns in their boards" 
ON public.columns 
FOR DELETE 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.boards 
  WHERE boards.id = columns.board_id 
  AND boards.user_id = auth.uid()
));