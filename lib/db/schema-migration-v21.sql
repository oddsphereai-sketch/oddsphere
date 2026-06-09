-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V21 — Make prediction_records.game_prediction_id
-- nullable for multi-sport tracking (Phase 7H · NBA tracking enablement)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file exists in the repo as the documented migration for the operator to
-- review BEFORE running it. Apply via the production apply plan at the bottom
-- of this file.
--
-- PHASE 7H — Add NBA into the existing prediction_records / prediction_grades
-- tracking system. NBA is the second sport (after MLB) to write tracking rows
-- and the first non-MLB sport ever to do so.
--
-- WHY
--   `prediction_records.game_prediction_id` was created in v17 as
--     BIGINT NOT NULL REFERENCES game_predictions(id)
--   because MLB was the only sport, and every MLB prediction originates
--   from a `game_predictions` row. NBA's pipeline (lib/services/nba/
--   buildNbaDailyEdgeAdapted) produces predictions DIRECTLY from the
--   daily-edge service — no corresponding game_predictions row exists,
--   and adding one would be a layering violation (game_predictions is
--   MLB-shaped: `predicted_nrfi`, `predicted_home_score` per-pitcher
--   context, etc.).
--
--   Relaxing the NOT NULL lets NBA writers populate the same
--   prediction_records / prediction_grades tables that MLB uses today,
--   so the existing tracking UI, aggregates, and grader stay
--   sport-generic without needing parallel NBA-only tables.
--
-- SHAPE
--   Single column-level constraint change. NO new columns, NO new
--   indexes, NO data movement. The FK itself stays in place — when a
--   row IS populated with a game_prediction_id (every MLB row), it
--   still references a real game_predictions(id). NBA rows simply
--   leave the column NULL.
--
-- SAFETY
--   • Additive constraint relaxation only — no constraint tightening,
--     no column drop.
--   • Existing MLB rows are untouched. The MLB writer in
--     `predictionRecordService.createPredictionRecords` continues to
--     populate the column on every insert, so MLB rows still have the
--     FK satisfied as before.
--   • The grader (`predictionGrader.gradePrediction`) does not read
--     `game_prediction_id` — it grades from (record.market, record.pick,
--     record.line_value, game.{status, scores}). No grader changes
--     required.
--   • The aggregation pipeline (`tracking_aggregates`,
--     `calibrationReport`) does not key on `game_prediction_id` either.
--     Per-sport / per-market roll-ups are driven by `sport`, `market`,
--     and `slate_date` columns which already exist.
--
-- ROLLBACK
--   ALTER TABLE prediction_records
--     ALTER COLUMN game_prediction_id SET NOT NULL;
--
--   This will fail if any NBA rows have been inserted with NULL — to
--   roll back fully, first DELETE WHERE sport='nba' AND
--   game_prediction_id IS NULL, then re-add the NOT NULL.
--
-- APPLY PLAN
--   1. Read the SQL block below in full.
--   2. From the operator's psql session against the production DB
--      (or the Supabase SQL editor):
--        \i lib/db/schema-migration-v21.sql
--   3. Verify the column is now nullable:
--        \d+ prediction_records
--      Expect: game_prediction_id bigint (NULL allowed).
--   4. Spot-check existing MLB rows are unchanged:
--        SELECT COUNT(*) FROM prediction_records
--          WHERE sport='mlb' AND game_prediction_id IS NULL;
--      Expect: 0 (all existing MLB rows still have the FK populated).
--   5. No rebuild required. No code change required on top of this
--      file (the type change in lib/types/domain/Tracking.ts already
--      reflects the relaxed shape).
--
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE prediction_records
  ALTER COLUMN game_prediction_id DROP NOT NULL;

COMMENT ON COLUMN prediction_records.game_prediction_id IS
  'FK to game_predictions(id). Nullable as of v21 — NBA (and future '
  'non-MLB sports) write predictions directly from the daily-edge '
  'service and have no corresponding game_predictions row. MLB rows '
  'continue to populate this column on every insert.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
