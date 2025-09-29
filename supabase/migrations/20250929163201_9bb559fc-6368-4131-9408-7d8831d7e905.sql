-- Add columns for safe claiming and quiet hours handling
ALTER TABLE public.scheduled_notifications 
ADD COLUMN processing_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN processing_instance TEXT,
ADD COLUMN queued_during_quiet BOOLEAN DEFAULT false,
ADD COLUMN original_scheduled_for TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance
CREATE INDEX idx_scheduled_notifications_claimable 
ON public.scheduled_notifications (scheduled_for) 
WHERE delivered_at IS NULL AND failed_at IS NULL AND processing_at IS NULL;

CREATE INDEX idx_scheduled_notifications_processing 
ON public.scheduled_notifications (processing_at, processing_instance) 
WHERE processing_at IS NOT NULL;

-- Function to safely claim due notifications
CREATE OR REPLACE FUNCTION public.claim_due_notifications(
  claim_limit INTEGER DEFAULT 50,
  instance_id TEXT DEFAULT gen_random_uuid()::text
) 
RETURNS SETOF public.scheduled_notifications 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_time TIMESTAMPTZ := now();
BEGIN
  -- Atomically claim and return due notifications
  RETURN QUERY
  UPDATE public.scheduled_notifications
  SET 
    processing_at = current_time,
    processing_instance = instance_id
  WHERE id IN (
    SELECT sn.id 
    FROM public.scheduled_notifications sn
    WHERE sn.scheduled_for <= current_time
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

-- Clear existing pending notifications to start fresh
DELETE FROM public.scheduled_notifications 
WHERE delivered_at IS NULL AND failed_at IS NULL;