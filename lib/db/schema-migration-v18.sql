-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V18 — Calibration Version Tag (Phase 6B.21 / 7A prep)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file exists in the repo as the documented migration for the operator to
-- review BEFORE running it. Apply via the production apply plan at the bottom
-- of this file, not via any automated tool.
--
-- PHASE 6B.21 — Schema preparation for Phase 7A (guarded auto-calibration)
--
-- WHY
--   Phase 7A will add a calibration layer that maps raw model probabilities
--   to confidence / play_grade with version-tagged parameters. To preserve
--   audit integrity across calibration revisions we need to tag each locked
--   prediction snapshot with the calibration version that informed it.
--
--   • If no calibration is applied (V1 launch + early 7A shadow): NULL.
--   • Once Stage 4 guarded auto-calibration is on: each prediction_records
--     row carries the calibration version active at lock time. Older rows
--     stay NULL — never backfilled.
--
-- SHAPE
--   Single additive nullable TEXT column on prediction_records. No
--   constraints, no defaults, no indexes (calibration history will live in
--   a separate `calibration_versions` table once 7A is implemented, but
--   that is OUT OF SCOPE for V18).
--
-- WHY ONLY prediction_records
--   Calibration shapes the PICK pipeline (probability → confidence → play
--   grade decision). It does not affect the GRADE pipeline (deterministic
--   from final score). If a future need arises to tag the calibration
--   that was active at grade-time (e.g., for back-fitted CLV math), a
--   separate migration can add the same column to prediction_grades. For
--   now keeping the column count minimal preserves the simplest possible
--   single-source semantics.
--
-- SAFETY
--   • Additive only — no existing column changes, no constraint changes.
--   • Nullable — existing rows stay NULL, no backfill required.
--   • Not referenced by any production code yet (write path will land in
--     Phase 7A Stage 4 behind the existing 4-layer guard).
--   • No reads against this column from any service in this push.
--   • No impact on tracking_aggregateService, predictionGrader, or any
--     existing aggregation. All Phase 6B.21 surface changes are
--     orthogonal to this column.
--
-- ROLLBACK
--   ALTER TABLE prediction_records DROP COLUMN IF EXISTS calibration_version;
--
-- APPLY PLAN
--   1. Read the SQL block below in full.
--   2. From the operator's psql session against the production DB:
--        \i lib/db/schema-migration-v18.sql
--   3. Verify the column exists:
--        \d+ prediction_records
--      Expect: calibration_version TEXT (nullable).
--   4. Spot-check a sample row:
--        SELECT id, calibration_version FROM prediction_records LIMIT 5;
--      Expect: column visible, all values NULL.
--   5. No rebuild required. No code change required.
--
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

-- Idempotent — re-running this migration is a no-op.
ALTER TABLE prediction_records
  ADD COLUMN IF NOT EXISTS calibration_version TEXT;

COMMENT ON COLUMN prediction_records.calibration_version IS
  'Phase 6B.21 — Tag for the calibration version active at lock time. '
  'NULL when no calibration was applied (default through V1 launch and '
  '7A shadow stages). Populated by the Phase 7A Stage 4 auto-calibration '
  'writer once guarded auto-apply is enabled. Never backfilled.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
