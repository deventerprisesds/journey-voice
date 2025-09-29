-- Fix the claim_due_notifications function to resolve the type mismatch error
-- The issue is that current_time conflicts with PostgreSQL's CURRENT_TIME keyword
DROP FUNCTION IF EXISTS public.claim_due_notifications(integer, text);

CREATE OR REPLACE FUNCTION public.claim_due_notifications(
  claim_limit integer DEFAULT 50, 
  instance_id text DEFAULT (gen_random_uuid())::text
)
RETURNS SETOF scheduled_notifications
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claim_timestamp TIMESTAMPTZ := now();
BEGIN
  -- Atomically claim and return due notifications
  RETURN QUERY
  UPDATE public.scheduled_notifications
  SET 
    processing_at = claim_timestamp,
    processing_instance = instance_id
  WHERE id IN (
    SELECT sn.id 
    FROM public.scheduled_notifications sn
    WHERE sn.scheduled_for <= claim_timestamp
      AND sn.delivered_at IS NULL
      AND sn.failed_at IS NULL 
      AND sn.processing_at IS NULL
    ORDER BY sn.scheduled_for, sn.created_at
    LIMIT claim_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;