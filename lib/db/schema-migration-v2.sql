-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere Lab — Schema Migration V2 (Phase 4A · Multi-Sport Scores Model)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Why this migration: Phase 4 introduces multi-sport scores-model support
-- (MLB / NBA / NFL / NHL / UCL / NCAAF / NCAAB) and an auto-model abstraction.
-- The original V1 schema named columns specifically for baseball (e.g.,
-- predicted_home_runs) and lacked per-sport extensibility fields. V2 adds:
--   1. Sport-agnostic naming: *_home_runs → *_home_score
--   2. sport_specific JSONB for fields that vary per sport (NRFI for MLB,
--      expected goals for UCL, listed_line for NBA, etc.)
--   3. prediction_source audit column (manual_daniel / auto_v1 / ...)
--   4. is_override + original_auto_prediction for future hybrid mode where
--      Daniel manually overrides specific auto-model predictions.
--   5. scores_model_runs table for per-run audit + performance comparison
--      between manual and future auto models.
--
-- Backward compatibility: the RENAME ... TO statements break any callers of
-- the old column names. Phase 4A's code propagation updates every reference
-- in lockstep before this migration runs. The seed/predict/daily-edge/
-- tracking-refresh scripts are re-verified against the new schema.
--
-- Execution: paste into Supabase SQL Editor and Run. All changes wrapped in
-- a single transaction so the migration is atomic (either all-or-nothing).
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Rename sport-specific columns to sport-agnostic ────────────────────
ALTER TABLE game_predictions
  RENAME COLUMN predicted_home_runs TO predicted_home_score;

ALTER TABLE game_predictions
  RENAME COLUMN predicted_away_runs TO predicted_away_score;

-- ── 2. Add multi-sport extensibility columns ──────────────────────────────
ALTER TABLE game_predictions
  ADD COLUMN sport_specific JSONB;

COMMENT ON COLUMN game_predictions.sport_specific IS
  'Per-sport extra fields: MLB { nrfi_pred, nrfi_confidence }; UCL { home_win_pct, draw_pct, away_win_pct, expected_goals_home, expected_goals_away }; NBA { listed_line }; etc.';

-- ── 3. Add audit-trail columns for manual vs auto-model attribution ───────
ALTER TABLE game_predictions
  ADD COLUMN prediction_source TEXT NOT NULL DEFAULT 'manual_daniel';

COMMENT ON COLUMN game_predictions.prediction_source IS
  'Which system produced this prediction: manual_daniel, auto_v1, auto_v2, etc. Drives calibration comparison and audit trail.';

ALTER TABLE game_predictions
  ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN game_predictions.is_override IS
  'TRUE when Daniel manually overrode an auto-model prediction (hybrid mode). When TRUE, original_auto_prediction stores what the auto-model said.';

ALTER TABLE game_predictions
  ADD COLUMN original_auto_prediction JSONB;

COMMENT ON COLUMN game_predictions.original_auto_prediction IS
  'Snapshot of the auto-model prediction at the time Daniel overrode it. NULL when is_override = FALSE.';

CREATE INDEX idx_game_predictions_source ON game_predictions (prediction_source);

-- ── 4. scores_model_runs — per-run audit + performance comparison ─────────
CREATE TABLE scores_model_runs (
  id                  BIGSERIAL PRIMARY KEY,
  sport               TEXT NOT NULL,                  -- 'mlb', 'nba', 'nfl', 'nhl', 'ucl', 'ncaaf', 'ncaab'
  source              TEXT NOT NULL,                  -- 'manual_daniel', 'auto_v1', 'auto_v2', ...
  run_date            DATE NOT NULL,                  -- The slate date this run targets
  predictions_count   INT  NOT NULL,
  successful_count    INT  NOT NULL,
  failed_count        INT  NOT NULL,
  model_version       TEXT,                           -- 'daniels-v3.2', 'auto-ncaab-v1', etc.
  started_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ,
  error_messages      TEXT[],                         -- Array of per-row failure reasons
  UNIQUE (sport, source, run_date)
);

COMMENT ON TABLE scores_model_runs IS
  'Audit trail of every scores-model run. Tracks predictions ingested per (sport, source, date) tuple. Used to compare manual vs auto-model performance over time.';

CREATE INDEX idx_scores_model_runs_sport_date ON scores_model_runs (sport, run_date DESC);
CREATE INDEX idx_scores_model_runs_source     ON scores_model_runs (source);

ALTER TABLE scores_model_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Confirm renames:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'game_predictions'
--      AND column_name IN ('predicted_home_score', 'predicted_away_score', 'predicted_home_runs', 'predicted_away_runs');
--    Expected: 2 rows (the new names), 0 rows for old names.
--
-- 2. Confirm new columns:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'game_predictions'
--      AND column_name IN ('sport_specific', 'prediction_source', 'is_override', 'original_auto_prediction');
--    Expected: 4 rows.
--
-- 3. Confirm scores_model_runs table exists:
--    SELECT count(*) FROM information_schema.tables WHERE table_name = 'scores_model_runs';
--    Expected: 1.
-- ═════════════════════════════════════════════════════════════════════════════
