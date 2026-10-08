-- Scheduled maintenance for the two tables that bloated the database to ~1.5 GB (measured 2026-10-08).
--
-- WHY THIS IS pg_cron AND NOT AUTOVACUUM SETTINGS:
--  * net._http_response (pg_net responses, UNLOGGED, 6h TTL) churns constantly — ~534K inserts and
--    deletes — but holds only ~1K live rows, so it rarely crosses autovacuum's thresholds and plain
--    vacuum never shrinks the file. It sat at 458 MB for 1,204 rows (last autovacuum 2026-08-05) and
--    made Supabase SQL calls time out. A one-off VACUUM FULL took it to 1.4 MB.
--  * cron.job_run_details (pg_cron history) is never pruned; the every-minute jobs add ~4,300
--    rows/day. It held ~805K rows / 696 MB; pruned to 7 days + VACUUM FULL → 14 MB.
--  * Per-table autovacuum reloptions need TABLE OWNERSHIP — both tables are owned by supabase_admin.
--    Global autovacuum_* GUCs are NOT in Supabase's CLI-overridable parameter list. So targeted,
--    scheduled VACUUM/prune is the supported way to "auto-tune" these. `postgres` holds the PG17
--    MAINTAIN privilege + DELETE on both tables, so these jobs run as postgres with no new secret.
--
-- Idempotent: unschedule any previous copy by name, then schedule.

select cron.unschedule(jobid) from cron.job
 where jobname in ('maint-http-response-vacuum', 'maint-cron-history-prune',
                   'maint-cron-history-vacuum', 'maint-weekly-vacuum-full');

-- Every 15 min: keep pg_net's dead space reusable so the file can't regrow. Non-blocking.
select cron.schedule('maint-http-response-vacuum', '*/15 * * * *',
  $$VACUUM (ANALYZE) net._http_response$$);

-- Daily 04:17 UTC: keep 7 days of cron run history (this job's own rows included).
select cron.schedule('maint-cron-history-prune', '17 4 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);

-- Daily 04:27 UTC: make the pruned space reusable.
select cron.schedule('maint-cron-history-vacuum', '27 4 * * *',
  $$VACUUM (ANALYZE) cron.job_run_details$$);

-- Sunday 04:37 UTC (00:37 ET): safety-net rewrite of the small pg_net table. Takes an exclusive lock
-- for ~1s; pg_net's worker just waits (requests queue in net.http_request_queue, none are lost).
select cron.schedule('maint-weekly-vacuum-full', '37 4 * * 0',
  $$VACUUM (FULL) net._http_response$$);
