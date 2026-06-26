-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V27 — Market Intelligence v2.1 safety metadata
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Additive repair layer for lock/as-of safety, line-basis honesty, and resolver
-- validity. This does not enable member UI and does not alter picks, grades,
-- prediction_records, lines, or sharp_signals.

BEGIN;

ALTER TABLE market_split_observations_v2
  ADD COLUMN IF NOT EXISTS split_line_basis TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS ingestion_run_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_split_observations_v2_line_basis_chk'
  ) THEN
    ALTER TABLE market_split_observations_v2
      ADD CONSTRAINT market_split_observations_v2_line_basis_chk
      CHECK (split_line_basis IN ('provider_explicit', 'paired_same_ingestion', 'unknown'));
  END IF;
END $$;

ALTER TABLE market_intelligence_snapshots_v2
  ADD COLUMN IF NOT EXISTS evidence_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS event_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommendation_snapshot_id BIGINT,
  ADD COLUMN IF NOT EXISTS recommendation_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_side TEXT,
  ADD COLUMN IF NOT EXISTS selected_line NUMERIC,
  ADD COLUMN IF NOT EXISTS selected_price INTEGER,
  ADD COLUMN IF NOT EXISTS validity_status TEXT NOT NULL DEFAULT 'insufficient_evidence';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_intelligence_snapshots_v2_validity_chk'
  ) THEN
    ALTER TABLE market_intelligence_snapshots_v2
      ADD CONSTRAINT market_intelligence_snapshots_v2_validity_chk
      CHECK (validity_status IN (
        'valid_directional',
        'valid_nondirectional',
        'insufficient_evidence',
        'stale_evidence',
        'provider_failure',
        'invalid_event_match'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS market_intelligence_snapshots_v2_safe_select_idx
  ON market_intelligence_snapshots_v2 (
    canonical_event_id,
    market_type,
    selection_key,
    validity_status,
    generated_at DESC
  );

CREATE INDEX IF NOT EXISTS market_intelligence_snapshots_v2_lock_select_idx
  ON market_intelligence_snapshots_v2 (
    recommendation_snapshot_id,
    market_type,
    selection_key,
    generated_at DESC
  )
  WHERE recommendation_snapshot_id IS NOT NULL;

COMMIT;
