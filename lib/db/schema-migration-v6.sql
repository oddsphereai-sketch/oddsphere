-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V6 — market_signal on predictions
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   V2.1 defines a 3-layer signal architecture (model · context · market).
--   This migration adds Layer 3 — market_signal — the categorical read of
--   what the betting market is doing on each pick. It's the input that
--   gradeDerivationService (Phase 6.3d) blends with the model edge and the
--   context signals already on prop_predictions.signals (V4) to produce a
--   final 7-category grade.
--
--   Game predictions get the same column because Daily Edge surfaces the
--   same grade vocabulary as Player Props — same engine, different display
--   labels per V2.1 Part 6.
--
-- SHAPE
--   market_signal TEXT, NULLABLE. Constrained to the 5-value V2.1 vocabulary:
--     market_confirmed    — sharp money + line move agree with model
--     market_neutral      — no meaningful market read either way
--     market_resistance   — market drifting against model conviction
--     public_smoke        — heavy public action without sharp confirmation
--     steam_alert         — sudden coordinated sharp move worth flagging
--
--   NULL is allowed (and is the default for existing rows + new inserts in
--   6.3a). marketSignalDerivationService (Phase 6.3c) populates the column
--   for each new slate; older rows stay NULL until backfilled.
--
-- COMPATIBILITY
--   New nullable column with no default — every existing INSERT still works.
--   Read paths must treat NULL as "no market read yet."
--
-- ROLLBACK
--   ALTER TABLE game_predictions DROP COLUMN market_signal;
--   ALTER TABLE prop_predictions DROP COLUMN market_signal;
--   (Plus drop the two CHECK constraints by name if they were left behind.)
--
-- NUMBERING NOTE
--   V6 → V7 → V8 → V11 → V12. The gap at V9/V10 is intentional — those
--   slots are reserved for later schema work outside Phase 6.3's scope.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── game_predictions.market_signal ────────────────────────────────────────
ALTER TABLE game_predictions
  ADD COLUMN IF NOT EXISTS market_signal TEXT;

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_market_signal_chk;

ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_market_signal_chk
  CHECK (
    market_signal IS NULL
    OR market_signal IN (
      'market_confirmed',
      'market_neutral',
      'market_resistance',
      'public_smoke',
      'steam_alert'
    )
  );

COMMENT ON COLUMN game_predictions.market_signal IS
  'Layer 3 market read for this pick. One of: market_confirmed, market_neutral, market_resistance, public_smoke, steam_alert. NULL = no derivation has run yet. Populated by marketSignalDerivationService (Phase 6.3c) and consumed by gradeDerivationService (Phase 6.3d).';

-- ── prop_predictions.market_signal ────────────────────────────────────────
ALTER TABLE prop_predictions
  ADD COLUMN IF NOT EXISTS market_signal TEXT;

ALTER TABLE prop_predictions
  DROP CONSTRAINT IF EXISTS prop_predictions_market_signal_chk;

ALTER TABLE prop_predictions
  ADD CONSTRAINT prop_predictions_market_signal_chk
  CHECK (
    market_signal IS NULL
    OR market_signal IN (
      'market_confirmed',
      'market_neutral',
      'market_resistance',
      'public_smoke',
      'steam_alert'
    )
  );

COMMENT ON COLUMN prop_predictions.market_signal IS
  'Layer 3 market read for this prop. Same vocabulary as game_predictions.market_signal. NULL until marketSignalDerivationService populates it.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Columns exist on both tables:
--    SELECT table_name, column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_name IN ('game_predictions', 'prop_predictions')
--      AND column_name = 'market_signal'
--    ORDER BY table_name;
--
-- 2. CHECK constraints registered:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'game_predictions_market_signal_chk',
--      'prop_predictions_market_signal_chk'
--    );
--
-- 3. All existing rows default to NULL (no derivation yet):
--    SELECT 'game_predictions' AS tbl, COUNT(*) AS total,
--           COUNT(market_signal) AS populated, COUNT(*) FILTER (WHERE market_signal IS NULL) AS null_rows
--    FROM game_predictions
--    UNION ALL
--    SELECT 'prop_predictions', COUNT(*), COUNT(market_signal), COUNT(*) FILTER (WHERE market_signal IS NULL)
--    FROM prop_predictions;
--
-- 4. CHECK rejects bad values (this should ERROR — confirms the constraint bites):
--    INSERT INTO game_predictions (game_id, market_signal, ...)
--    VALUES ('test', 'invalid_value', ...);   -- expect: violates check constraint
-- ═════════════════════════════════════════════════════════════════════════════
