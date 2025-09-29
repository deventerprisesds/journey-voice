-- Clear the notification queue by deleting all pending notifications
DELETE FROM public.scheduled_notifications 
WHERE delivered_at IS NULL AND failed_at IS NULL;

-- Add an index to improve batching performance
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_batching 
ON public.scheduled_notifications (user_id, scheduled_for, delivered_at, failed_at) 
WHERE delivered_at IS NULL AND failed_at IS NULL;