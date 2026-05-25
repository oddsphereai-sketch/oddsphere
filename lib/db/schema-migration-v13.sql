-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V13 — per-pick grade columns on game_predictions
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   V2.1 shipped row-level grades on game_predictions: ONE grade per row,
--   reflecting the row's "primary pick" via ML → OU → NRFI precedence. A
--   single game thus collapsed to a single grade headline regardless of
--   meaningful signal divergence across markets. External review surfaced
--   the limitation: a game can be Sharp Confirmed on ML and Market Watch
--   on the total. The headline-only model lost that nuance.
--
--   V2.1.1 evolution (Phase 6.3.5): per-pick grade granularity. game_pred-
--   ictions gains 9 new columns — three per market (ml / ou / nrfi), each
--   carrying the same grade / signal_type / market_signal triplet the
--   row-level columns held. The "headline" remains a meaningful concept;
--   it's now derived from the per-pick columns at read time (or as a
--   denormalized cache via dual-write during transition).
--
-- SHAPE
--   9 new columns added to game_predictions:
--     ml_grade           ml_signal_type           ml_market_signal
--     ou_grade           ou_signal_type           ou_market_signal
--     nrfi_grade         nrfi_signal_type         nrfi_market_signal
--
--   All nullable TEXT. CHECK constraints reuse the V6/V7 vocabularies:
--     • grade        → 7 values (best_signal / sharp_confirmed / market_led /
--                                model_only / market_watch / public_smoke /
--                                sharp_conflict) or NULL
--     • signal_type  → 5 values (model_dominant / market_dominant / balanced /
--                                model_only / market_only) or NULL
--     • market_signal→ 5 values (market_confirmed / market_neutral /
--                                market_resistance / public_smoke /
--                                steam_alert) or NULL
--
-- COMPATIBILITY
--   ✓ Purely additive. Existing reads + writes against the old row-level
--     columns (grade / signal_type / market_signal) continue working
--     unchanged after this migration applies. New columns sit NULL until
--     6.3.5b's service rewrite begins populating them.
--   ✓ Dual-write transition: Phase 6.3.5b services write BOTH the new
--     per-pick columns AND the legacy row-level columns. Phase 6.3.5c/d
--     migrate readers (DTO, route, UI) to consume per-pick. Phase 6.3.5f
--     verifies parity via a backfill cron run. A future V14 (separate
--     cleanup commit) drops the legacy row-level columns once nothing
--     reads them.
--   ✓ prop_predictions is NOT touched — props are already per-pick (one
--     row per game × player × prop_market tuple). The existing grade /
--     signal_type / market_signal columns there stay authoritative.
--   ✓ prediction_results.signal_type is NOT touched — that table is
--     already row-level by design (each result row is one resolved pick).
--
-- ROLLBACK
--   ALTER TABLE game_predictions
--     DROP COLUMN ml_grade,           DROP COLUMN ml_signal_type,           DROP COLUMN ml_market_signal,
--     DROP COLUMN ou_grade,           DROP COLUMN ou_signal_type,           DROP COLUMN ou_market_signal,
--     DROP COLUMN nrfi_grade,         DROP COLUMN nrfi_signal_type,         DROP COLUMN nrfi_market_signal;
--   (Constraint drops follow automatically when columns are dropped.)
--
-- NUMBERING NOTE
--   V13 follows V12 (admin_audit_log). V9/V10 remain reserved (auth users,
--   tracking_baseline). The V11/V12 gap was intentional in Phase 6.3a;
--   no new gap introduced here.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add 9 per-pick columns in one compound ALTER ──────────────────────
ALTER TABLE game_predictions
  ADD COLUMN IF NOT EXISTS ml_grade           TEXT,
  ADD COLUMN IF NOT EXISTS ml_signal_type     TEXT,
  ADD COLUMN IF NOT EXISTS ml_market_signal   TEXT,
  ADD COLUMN IF NOT EXISTS ou_grade           TEXT,
  ADD COLUMN IF NOT EXISTS ou_signal_type     TEXT,
  ADD COLUMN IF NOT EXISTS ou_market_signal   TEXT,
  ADD COLUMN IF NOT EXISTS nrfi_grade         TEXT,
  ADD COLUMN IF NOT EXISTS nrfi_signal_type   TEXT,
  ADD COLUMN IF NOT EXISTS nrfi_market_signal TEXT;

-- ── 2. CHECK constraints — grade columns (ml / ou / nrfi) ────────────────
ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_ml_grade_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ml_grade_chk
  CHECK (
    ml_grade IS NULL
    OR ml_grade IN (
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
  DROP CONSTRAINT IF EXISTS game_predictions_ou_grade_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ou_grade_chk
  CHECK (
    ou_grade IS NULL
    OR ou_grade IN (
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
  DROP CONSTRAINT IF EXISTS game_predictions_nrfi_grade_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_nrfi_grade_chk
  CHECK (
    nrfi_grade IS NULL
    OR nrfi_grade IN (
      'best_signal',
      'sharp_confirmed',
      'market_led',
      'model_only',
      'market_watch',
      'public_smoke',
      'sharp_conflict'
    )
  );

-- ── 3. CHECK constraints — signal_type columns (ml / ou / nrfi) ──────────
ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_ml_signal_type_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ml_signal_type_chk
  CHECK (
    ml_signal_type IS NULL
    OR ml_signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_ou_signal_type_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ou_signal_type_chk
  CHECK (
    ou_signal_type IS NULL
    OR ou_signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_nrfi_signal_type_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_nrfi_signal_type_chk
  CHECK (
    nrfi_signal_type IS NULL
    OR nrfi_signal_type IN (
      'model_dominant',
      'market_dominant',
      'balanced',
      'model_only',
      'market_only'
    )
  );

-- ── 4. CHECK constraints — market_signal columns (ml / ou / nrfi) ────────
ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_ml_market_signal_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ml_market_signal_chk
  CHECK (
    ml_market_signal IS NULL
    OR ml_market_signal IN (
      'market_confirmed',
      'market_neutral',
      'market_resistance',
      'public_smoke',
      'steam_alert'
    )
  );

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_ou_market_signal_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_ou_market_signal_chk
  CHECK (
    ou_market_signal IS NULL
    OR ou_market_signal IN (
      'market_confirmed',
      'market_neutral',
      'market_resistance',
      'public_smoke',
      'steam_alert'
    )
  );

ALTER TABLE game_predictions
  DROP CONSTRAINT IF EXISTS game_predictions_nrfi_market_signal_chk;
ALTER TABLE game_predictions
  ADD CONSTRAINT game_predictions_nrfi_market_signal_chk
  CHECK (
    nrfi_market_signal IS NULL
    OR nrfi_market_signal IN (
      'market_confirmed',
      'market_neutral',
      'market_resistance',
      'public_smoke',
      'steam_alert'
    )
  );

-- ── 5. COMMENT ON COLUMN for each new field ──────────────────────────────
COMMENT ON COLUMN game_predictions.ml_grade IS
  'V2.1.1 per-pick grade for the moneyline pick (Phase 6.3.5). Same 7-value vocabulary as the legacy grade column. NULL until Phase 6.3.5b services populate it.';
COMMENT ON COLUMN game_predictions.ml_signal_type IS
  'V2.1.1 per-pick signal_type attribution for the moneyline pick. Same 5-value vocabulary as the legacy signal_type column.';
COMMENT ON COLUMN game_predictions.ml_market_signal IS
  'V2.1.1 per-pick Layer 3 market read for the moneyline pick. Same 5-value vocabulary as the legacy market_signal column.';

COMMENT ON COLUMN game_predictions.ou_grade IS
  'V2.1.1 per-pick grade for the over/under (total) pick.';
COMMENT ON COLUMN game_predictions.ou_signal_type IS
  'V2.1.1 per-pick signal_type attribution for the over/under pick.';
COMMENT ON COLUMN game_predictions.ou_market_signal IS
  'V2.1.1 per-pick Layer 3 market read for the over/under pick.';

COMMENT ON COLUMN game_predictions.nrfi_grade IS
  'V2.1.1 per-pick grade for the first-inning total (NRFI/YRFI) pick.';
COMMENT ON COLUMN game_predictions.nrfi_signal_type IS
  'V2.1.1 per-pick signal_type attribution for the first-inning pick.';
COMMENT ON COLUMN game_predictions.nrfi_market_signal IS
  'V2.1.1 per-pick Layer 3 market read for the first-inning pick.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. All 9 columns landed with the expected nullable shape:
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'game_predictions'
--      AND column_name IN (
--        'ml_grade', 'ml_signal_type', 'ml_market_signal',
--        'ou_grade', 'ou_signal_type', 'ou_market_signal',
--        'nrfi_grade', 'nrfi_signal_type', 'nrfi_market_signal'
--      )
--    ORDER BY column_name;
--    -- Expect: 9 rows, all data_type='text', all is_nullable='YES'.
--
-- 2. All 9 CHECK constraints registered:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'game_predictions_ml_grade_chk',
--      'game_predictions_ou_grade_chk',
--      'game_predictions_nrfi_grade_chk',
--      'game_predictions_ml_signal_type_chk',
--      'game_predictions_ou_signal_type_chk',
--      'game_predictions_nrfi_signal_type_chk',
--      'game_predictions_ml_market_signal_chk',
--      'game_predictions_ou_market_signal_chk',
--      'game_predictions_nrfi_market_signal_chk'
--    )
--    ORDER BY conname;
--    -- Expect: 9 rows, each definition referencing the right column + value list.
--
-- 3. Existing rows are NULL on every new column (no implicit backfill):
--    SELECT
--      COUNT(*) AS total,
--      COUNT(ml_grade) AS ml_graded,
--      COUNT(ou_grade) AS ou_graded,
--      COUNT(nrfi_grade) AS nrfi_graded
--    FROM game_predictions;
--    -- Expect: ml_graded = ou_graded = nrfi_graded = 0 (all NULL post-migration).
--
-- 4. Legacy row-level columns unchanged (dual-write transition):
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'game_predictions'
--      AND column_name IN ('grade', 'signal_type', 'market_signal');
--    -- Expect: 3 rows. They keep getting populated by services through Phase 6.3.5f.
--
-- 5. CHECK rejects bad values (this should ERROR):
--    UPDATE game_predictions SET ml_grade = 'gold_star'
--    WHERE id = (SELECT id FROM game_predictions LIMIT 1);
--    -- Expect: ERROR — new row for relation "game_predictions" violates
--    --         check constraint "game_predictions_ml_grade_chk".
-- ═════════════════════════════════════════════════════════════════════════════
