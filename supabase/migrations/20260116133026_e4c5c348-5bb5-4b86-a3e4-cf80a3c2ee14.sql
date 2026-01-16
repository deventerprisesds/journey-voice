-- Prevent duplicate notifications for the same task, type, and scheduled time
-- Only applies to notifications that have a task_id (task-related notifications)
CREATE UNIQUE INDEX IF NOT EXISTS unique_task_notification_type_time 
ON scheduled_notifications (task_id, notification_type, scheduled_for)
WHERE task_id IS NOT NULL;