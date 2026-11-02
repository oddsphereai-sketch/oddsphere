-- Speed up the unchanged refreshLogger.getLastCompleted/getLastHealthyCompleted
-- queries. This index contains lifecycle metadata only, never snapshot payloads.
-- Both sport = <sport> and sport IS NULL can seek directly to the newest
-- completed timestamp; refresh_status is available for the existing filters.
-- No query, row, capture cadence, lease, model input, or locked value changes.
--
-- Apply this statement on its own, outside a transaction, after protected PR
-- publication. CONCURRENTLY keeps lifecycle writes available during the build.
-- Check pg_index.indisvalid/indisready and pg_get_indexdef after application;
-- IF NOT EXISTS alone does not prove an existing index is correct or valid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_log_completed_lookup
  ON public.data_refresh_log (data_source, sport, refresh_completed_at DESC)
  INCLUDE (refresh_status)
  WHERE refresh_completed_at IS NOT NULL;
