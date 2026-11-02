-- Apply individually after protected publication. This samples only filter /
-- ordering metadata, never the large payload, raw_payload, or snapshot_json.
-- The 1 MB buffer ring limits eviction of hot market data. SKIP_LOCKED avoids
-- waiting on a conflicting maintenance/DDL job; verify every requested table
-- afterwards and retry a skipped table in a quiet window.
-- No rows, model values, locks, read windows, cadence or retention are changed.
ANALYZE (BUFFER_USAGE_LIMIT '1MB', SKIP_LOCKED)
  public.data_refresh_log (data_source, sport, refresh_status, refresh_started_at, refresh_completed_at);
ANALYZE (BUFFER_USAGE_LIMIT '1MB', SKIP_LOCKED)
  public.cfb_forward_evidence_snapshots (id, season, week, evidence_release, provider_game_id, stage, captured_at);
ANALYZE (BUFFER_USAGE_LIMIT '1MB', SKIP_LOCKED)
  public.nfl_forward_evidence_snapshots (id, season, week, evidence_release, provider_game_id, stage, captured_at);
ANALYZE (BUFFER_USAGE_LIMIT '1MB', SKIP_LOCKED)
  public.market_price_observations_v2 (id, league, provider, canonical_event_id, sportsbook, market_type, fetched_at, provider_timestamp);
ANALYZE (BUFFER_USAGE_LIMIT '1MB', SKIP_LOCKED)
  public.market_split_observations_v2 (id, league, provider, canonical_event_id, source_book, market_type, fetched_at, source_observed_at);
