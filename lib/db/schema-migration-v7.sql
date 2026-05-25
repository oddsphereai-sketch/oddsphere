-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V7 — grade + signal_type tracking
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   This is the persistence layer for V2.1's unified 7-category grade engine
--   (Part 6) plus the signal_type attribution used in tracking analytics.
--
--   • grade        — the final blended verdict for a pick (1 of 7 categories).
--                    gradeDerivationService (Phase 6.3d) writes it; UI in
--                    6.4/6.5 reads it; tracking aggregates by it.
--   • signal_type  — the dominant signal source that drove the grade
--                    (e.g. "model_dominant", "market_dominant", "balanced").
--                    Lets us answer "how does our market-led picks ROI compare
--                    to model-only picks?" without re-deriving from raw data.
--
--   prediction_results carries signal_type so tracking can pivot historical
--   W/L by signal source without joining back to the predictions table
--   (which is regenerated every slate cycle).
--
-- SHAPE
--   grade TEXT, NULLABLE. One of the 7 V2.1 grades:
--     best_signal · sharp_confirmed · market_led · model_only ·
--     market_watch · public_smoke · sharp_conflict
--
--   signal_type TEXT, NULLABLE. One of 5 attribution values:
--     model_dominant · market_dominant · balanced · model_only · market_only
--
--   Both are NULL by default — populated by gradeDerivationService when
--   it runs. NULL on prediction_results means "this result was logged
--   before the grade engine shipped" — tracking handles that gracefully.
--
-- COMPATIBILITY
--   All-nullable, no defaults. Existing INSERT paths keep working. CHECK
--   constraints enforce the vocabulary so a typo can't silently land bad
--   data — they bite at INSERT/UPDATE time, not at read.
--
-- ROLLBACK
--   ALTER TABLE game_predictions DROP COLUMN grade, DROP COLUMN signal_type;
--   ALTER TABLE prop_predictions DROP COLUMN grade, DROP COLUMN signal_type;
--   ALTER TABLE prediction_results DROP COLUMN signal_type;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── game_predictions: grade + signal_type ─────────────────────────────────
ALTER TABLE game_predictions
  ADD COLUMN IF NOT EXISTS grade TEXT,
  ADD COLUMN IF NOT EXISTS signal_type TEXT;

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_grade_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_grade_chk
  CHECK (
    grade IS NULL
    OR grade IN (
      'best_signal',
      'sharp_confirmed',
      'market_led',
      'model_only',
      'market_watch',
      'public_smoke',
      'sharp_conflict'
    )
  );

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_signal_type_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_signal_type_chk
  CHECK (
    signal_type IS NULL
    OR signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

COMMENT ON COLUMN game_predictions.grade IS
  'V2.1 7-category final grade. One of: best_signal, sharp_confirmed, market_led, model_only, market_watch, public_smoke, sharp_conflict. NULL = gradeDerivationService has not yet run for this row.';
COMMENT ON COLUMN game_predictions.signal_type IS
  'Attribution of which layer drove the grade. One of: model_dominant, market_dominant, balanced, model_only, market_only. NULL = pre-derivation.';

-- ── prop_predictions: grade + signal_type ─────────────────────────────────
ALTER TABLE prop_predictions
  ADD COLUMN IF NOT EXISTS grade TEXT,
  ADD COLUMN IF NOT EXISTS signal_type TEXT;

ALTER TABLE prop_predictions
  DROP CONSTRAINT IF EXISTS prop_predictions_grade_chk;
ALTER TABLE prop_predictions
  ADD CONSTRAINT prop_predictions_grade_chk
  CHECK (
    grade IS NULL
    OR grade IN (
      'best_signal',
      'sharp_confirmed',
      'market_led',
      'model_only',
      'market_watch',
      'public_smoke',
      'sharp_conflict'
    )
  );

ALTER TABLE prop_predictions
  DROP CONSTRAINT IF EXISTS prop_predictions_signal_type_chk;
ALTER TABLE prop_predictions
  ADD CONSTRAINT prop_predictions_signal_type_chk
  CHECK (
    signal_type IS NULL
    OR signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

COMMENT ON COLUMN prop_predictions.grade IS
  'V2.1 7-category final grade. Same vocabulary as game_predictions.grade.';
COMMENT ON COLUMN prop_predictions.signal_type IS
  'Attribution of which layer drove the grade. Same vocabulary as game_predictions.signal_type.';

-- ── prediction_results: signal_type only (no grade — grade lives on the prediction) ──
ALTER TABLE prediction_results
  ADD COLUMN IF NOT EXISTS signal_type TEXT;

ALTER TABLE prediction_results
  DROP CONSTRAINT IF EXISTS prediction_results_signal_type_chk;
ALTER TABLE prediction_results
  ADD CONSTRAINT prediction_results_signal_type_chk
  CHECK (
    signal_type IS NULL
    OR signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

COMMENT ON COLUMN prediction_results.signal_type IS
  'Carries the signal_type from the prediction at resolve time so historical tracking can group by signal source without joining a predictions table that gets regenerated each slate.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. All five columns landed:
--    SELECT table_name, column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE (table_name = 'game_predictions' AND column_name IN ('grade','signal_type'))
--       OR (table_name = 'prop_predictions' AND column_name IN ('grade','signal_type'))
--       OR (table_name = 'prediction_results' AND column_name = 'signal_type')
--    ORDER BY table_name, column_name;
--
-- 2. All five CHECK constraints registered:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'game_predictions_grade_chk', 'game_predictions_signal_type_chk',
--      'prop_predictions_grade_chk', 'prop_predictions_signal_type_chk',
--      'prediction_results_signal_type_chk'
--    );
--
-- 3. Existing rows all NULL (no grade engine has run):
--    SELECT 'game_predictions' AS tbl, COUNT(*) AS total,
--           COUNT(grade) AS graded, COUNT(signal_type) AS typed
--    FROM game_predictions
--    UNION ALL SELECT 'prop_predictions', COUNT(*), COUNT(grade), COUNT(signal_type)
--    FROM prop_predictions
--    UNION ALL SELECT 'prediction_results', COUNT(*), NULL, COUNT(signal_type)
--    FROM prediction_results;
--
-- 4. Bad value rejected (this should ERROR):
--    UPDATE game_predictions SET grade = 'gold_star' WHERE id = (SELECT id FROM game_predictions LIMIT 1);
-- ═════════════════════════════════════════════════════════════════════════════
