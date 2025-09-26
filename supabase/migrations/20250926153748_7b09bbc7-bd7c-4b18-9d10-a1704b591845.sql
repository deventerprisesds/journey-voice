-- Fix security vulnerability: Remove anonymous access from extracted_content table
-- This ensures only authenticated users can access their own extracted content data

-- Drop existing policies that allow anonymous access
DROP POLICY IF EXISTS "Allow anonymous and user access for viewing extracted content" ON public.extracted_content;
DROP POLICY IF EXISTS "Allow anonymous and user access for creating extracted content" ON public.extracted_content;
DROP POLICY IF EXISTS "Allow anonymous and user access for updating extracted content" ON public.extracted_content;
DROP POLICY IF EXISTS "Allow anonymous and user access for deleting extracted content" ON public.extracted_content;

-- Create new secure policies that only allow authenticated users to access their own data
CREATE POLICY "Users can view their own extracted content" 
ON public.extracted_content 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own extracted content" 
ON public.extracted_content 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own extracted content" 
ON public.extracted_content 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own extracted content" 
ON public.extracted_content 
FOR DELETE 
USING (auth.uid() = user_id);

-- Clean up any existing anonymous data (optional - only if you want to remove existing anonymous records)
-- DELETE FROM public.extracted_content WHERE user_id = '00000000-0000-0000-0000-000000000000';