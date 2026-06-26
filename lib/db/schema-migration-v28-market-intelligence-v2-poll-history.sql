-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V28 — Market Intelligence v2 poll history
-- ═════════════════════════════════════════════════════════════════════════════
--
-- V26 de-duped split observations by raw payload hash. That prevented
-- unchanged-but-new provider polls from becoming historical observations.
-- For chronological validation we need one row per provider poll, while still
-- preserving idempotency inside the same poll timestamp.

BEGIN;

ALTER TABLE market_split_observations_v2
  DROP CONSTRAINT IF EXISTS market_split_observations_v2_unique_payload;

ALTER TABLE market_split_observations_v2
  ADD CONSTRAINT market_split_observations_v2_unique_poll_payload
  UNIQUE (
    provider,
    source_book,
    canonical_event_id,
    canonical_market_id,
    selection_key,
    raw_payload_hash,
    fetched_at
  );

CREATE INDEX IF NOT EXISTS market_split_observations_v2_ingestion_run_idx
  ON market_split_observations_v2 (ingestion_run_id, provider, source_book)
  WHERE ingestion_run_id IS NOT NULL;

COMMIT;
