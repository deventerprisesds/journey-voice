-- Create notification_trace view for end-to-end debugging
-- Joins tasks → scheduled_notifications → external_calendar_events → activity_log
CREATE OR REPLACE VIEW notification_trace AS
SELECT 
  t.id as task_id,
  t.title as task_title,
  t.start_time as task_start_time,
  t.created_at as task_created_at,
  t.status as task_status,
  t.user_id,
  sn.id as notification_id,
  sn.notification_type,
  sn.scheduled_for,
  sn.delivered_at,
  sn.failed_at,
  sn.failure_reason,
  ece.id as calendar_event_id,
  ece.external_event_id,
  ece.created_at as calendar_created_at,
  al.activity_type as activity_event,
  al.created_at as activity_timestamp,
  al.stage as activity_stage,
  al.status as activity_status,
  al.error_message as activity_error,
  al.metadata as activity_metadata
FROM tasks t
LEFT JOIN scheduled_notifications sn ON sn.task_id = t.id
LEFT JOIN external_calendar_events ece ON ece.source_task_id = t.id
LEFT JOIN activity_log al ON (
  al.session_id = t.id::text 
  OR al.session_id = sn.id::text
  OR al.metadata->>'task_id' = t.id::text
)
WHERE t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC, al.created_at ASC;