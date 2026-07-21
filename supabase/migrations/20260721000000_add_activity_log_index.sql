-- Speed up alarm trace queries — activity_log has no index on activity_type,
-- causing all debug-alarm-trace workflow queries to timeout (HTTP 500, code 57014).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_log_type_created
  ON activity_log (activity_type, created_at DESC);
