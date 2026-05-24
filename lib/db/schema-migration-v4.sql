-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V4 — prop_predictions.signals
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   Phase 5F.2 introduces a signal-derivation service that tags each prop
--   prediction with categorical context (e.g., "vs_lhp", "wind_out",
--   "park", "platoon"). The Lab UI shows these as filter chips on Search &
--   Filter mode and as tag pills on the prop card.
--
--   Pre-5F.2 the chips rendered but didn't filter — the route returned
--   `signals: []` for every prop. This migration adds the column the service
--   writes into; routes return it; UI consumes it.
--
-- SHAPE
--   signals is JSONB storing an array of Signal-union strings. Empty array
--   is the default (no signals derived yet). Validated at the application
--   layer — Postgres treats it as opaque JSON.
--
-- COMPATIBILITY
--   New column with safe default. Existing rows get []. The seed's back-seed
--   pass (added in 5F.2) populates signals for the curated seed slate.
--
-- ROLLBACK
--   ALTER TABLE prop_predictions DROP COLUMN signals;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE prop_predictions
  ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prop_predictions.signals IS
  'Categorical context tags computed by signalDerivationService. Array of strings drawn from the Signal union: hot, cold, vs_lhp, vs_rhp, wind_out, wind_in, park, rest_advantage, platoon, warning. Empty array = no actionable context. Recomputed every prop-generation cycle.';

-- GIN index for the chip filter — `signals ?| array[...]` runs against this.
CREATE INDEX IF NOT EXISTS prop_predictions_signals_gin
  ON prop_predictions USING GIN (signals jsonb_path_ops);

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Column + index exist:
--    SELECT column_name, data_type, column_default, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'prop_predictions' AND column_name = 'signals';
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'prop_predictions' AND indexname = 'prop_predictions_signals_gin';
--
-- 2. Every existing row defaulted to []:
--    SELECT COUNT(*) AS total,
--           COUNT(*) FILTER (WHERE signals = '[]'::jsonb) AS empty,
--           COUNT(*) FILTER (WHERE jsonb_array_length(signals) > 0) AS populated
--    FROM prop_predictions;
--
-- 3. After running `npm run seed`, the seed slate should have populated rows:
--    SELECT
--      jsonb_array_length(signals) AS num_signals,
--      COUNT(*) AS rows
--    FROM prop_predictions
--    GROUP BY num_signals ORDER BY num_signals;
-- ═════════════════════════════════════════════════════════════════════════════
