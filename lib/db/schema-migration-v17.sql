-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V17 — Tracking Foundation (Push 4 / 6B.1.4)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file exists in the repo as the documented migration for the operator to
-- review BEFORE running it. Apply via the production apply plan at the bottom
-- of this file, not via any automated tool.
--
-- PUSH 4 — Lifecycle and tracking foundation
--
-- WHY
--   OddSphere ships its launch model on 2026-06-06. From tomorrow forward we
--   need a real tracking foundation that supports:
--     • model evaluation across versions (V2.1, future V2.2, future FI V2)
--     • Best Angle vs Lean performance breakdowns
--     • per-market, per-sport, per-confidence-bucket calibration
--     • Brier / log-loss inputs for future calibration work
--     • imported historical baselines as the launch reference point
--     • idempotent prediction snapshots taken at lock/publish time
--     • final-score-driven grading with safe pending states for FI markets
--   Without dedicated tables this would all have to live in `game_predictions`
--   alongside the live prediction state — risking accidental modification of
--   already-graded picks and corrupting the historical record.
--
-- SHAPE
--   Three new tables, all additive and FK-anchored to the existing schema.
--   No changes to any existing table. No constraint changes on `games` or
--   `game_predictions`. No indexes touching existing tables. No triggers.
--
--   1. `tracking_baselines`
--      Imported historical aggregate records from the legacy tracking CSV
--      (2025-pre-launch data). One row per sport-market label. Treated as
--      reference, never row-level. Idempotent on (source_label, imported_from).
--
--   2. `prediction_records`
--      Immutable snapshot of one (game × market) prediction at the moment
--      it became eligible for tracking (typically at lock or publish). One
--      row per non-held market. Preserves all V2.1 audit fields plus a
--      JSONB snapshot for future recalibration work. Idempotent on
--      (game_id, market, model_version, slate_date).
--
--   3. `prediction_grades`
--      One row per `prediction_records` row after the underlying game
--      reaches `status=final`. Result is one of win / loss / push / void /
--      pending. NRFI/YRFI grades stay pending until first-inning score
--      is available (never inferred from full-game total). Idempotent
--      on prediction_record_id (1:1).
--
--   Together these three give the launch tracking system everything it
--   needs to:
--     • render an admin tracking dashboard with model performance
--     • render a member-safe tracking page (baselines today, fresh
--       Daily Edge tracking from tomorrow)
--     • feed a future calibration pipeline (Brier, log-loss, confidence
--       bucket reliability)
--     • support future V2.2 model comparison side-by-side with V2.1
--
-- BACKFILL
--   NONE for prediction_records and prediction_grades — the launch model
--   is prospective and the legacy MLB picks are captured in the imported
--   CSV baseline instead.
--
--   tracking_baselines IS the backfill: one operator-run import of the
--   2025 legacy CSV (`scripts/operator/import-tracking-baseline.ts`),
--   17 aggregate rows.
--
-- COMPATIBILITY
--   ✓ Purely additive — three new tables, no changes elsewhere.
--   ✓ FK relationships are RESTRICT on delete (default) so dropping a
--     game / game_prediction can't silently break tracking history.
--     If a delete is ever needed, operator must purge tracking_grades →
--     prediction_records → game_predictions / games in that order.
--   ✓ Idempotent migration — wrapped in IF NOT EXISTS for tables,
--     constraints, and indexes. Re-running is a no-op.
--   ✓ No RLS policies added. Tracking pages query through the existing
--     supabase service-role client, matching the rest of the codebase.
--   ✓ All existing tests + the Push 1/2 services are unaffected by this
--     migration. The new services this enables are not used unless
--     operator runs them.
--
-- ROLLBACK
--   BEGIN;
--   DROP TABLE IF EXISTS prediction_grades;
--   DROP TABLE IF EXISTS prediction_records;
--   DROP TABLE IF EXISTS tracking_baselines;
--   COMMIT;
--
--   Fully reversible because no existing table references the new tables
--   and the new tables hold operator-owned data only (baselines, snapshots,
--   grades). If new code paths have already shipped that read these
--   tables, roll back code first then DDL.
--
-- VERIFICATION
--   Run these SELECTs after the migration to confirm correct shape:
--
--   -- 1. Three tables exist in public schema
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('tracking_baselines','prediction_records','prediction_grades');
--   -- Expected: exactly 3 rows.
--
--   -- 2. tracking_baselines is empty (no rows until import operator runs)
--   SELECT COUNT(*) FROM tracking_baselines;
--   -- Expected: 0.
--
--   -- 3. prediction_records is empty (no rows until create-prediction-records runs)
--   SELECT COUNT(*) FROM prediction_records;
--   -- Expected: 0.
--
--   -- 4. prediction_grades is empty (no rows until grader runs)
--   SELECT COUNT(*) FROM prediction_grades;
--   -- Expected: 0.
--
--   -- 5. Unique constraint on baselines is present
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'tracking_baselines'::regclass AND contype = 'u';
--   -- Expected: tracking_baselines_source_imported_key.
--
--   -- 6. Unique constraint on prediction_records is present
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'prediction_records'::regclass AND contype = 'u';
--   -- Expected: prediction_records_game_market_version_slate_key.
--
-- RISKS
--   • DDL fails mid-flight
--     Severity: low. Each CREATE TABLE is atomic. The migration is
--     wrapped in a single transaction below so partial failure rolls back.
--   • Permissions on service-role insufficient to CREATE TABLE
--     Severity: low. Existing schema migrations have all used the same
--     role and succeeded. If permission fails, the operator sees a clean
--     error before any DDL is committed.
--   • Tracking table types drift from application types
--     Severity: low. The TypeScript types in `lib/types/domain/Tracking.ts`
--     are designed to mirror this SQL exactly. Any drift will surface at
--     compile time on the first read.
--
-- APPLY PLAN (operator-only — manual)
--   1. Review the CREATE TABLE statements below in this file.
--   2. Open Supabase SQL Editor → paste the entire APPLY block below.
--   3. Run.
--   4. Run the VERIFICATION SELECTs above.
--   5. After verification, run the post-migration operator commands listed
--      in the Push 4 commit message:
--        a. import-tracking-baseline.ts --apply
--        b. create-prediction-records.ts --date 2026-06-06 --apply (launch day)
--        c. ingest-final-scores.ts --date 2026-06-06 (after games end)
--        d. grade-predictions.ts --date 2026-06-06 (manual or operator)
--
-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY BLOCK — copy from BEGIN; through COMMIT; into Supabase SQL editor
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. tracking_baselines ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracking_baselines (
  id                    BIGSERIAL PRIMARY KEY,
  source_label          TEXT        NOT NULL,           -- e.g. "MLB (ML) ⚾"
  sport                 TEXT        NOT NULL,           -- mlb / nfl / nba / cfb / cbb / nhl / ucl
  market                TEXT        NOT NULL,           -- moneyline / total / first_inning / nrfi / yrfi / double_chance
  model_family          TEXT        NOT NULL DEFAULT 'legacy',
  lifetime_wins         INTEGER     NOT NULL,
  lifetime_total        INTEGER     NOT NULL,
  lifetime_pct          NUMERIC(5,2) NOT NULL,
  current_season_wins   INTEGER,
  current_season_total  INTEGER,
  current_season_pct    NUMERIC(5,2),
  weekly_wins           INTEGER,
  weekly_total          INTEGER,
  weekly_pct            NUMERIC(5,2),
  imported_from         TEXT        NOT NULL,           -- filename of source CSV
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                 JSONB,
  CONSTRAINT tracking_baselines_source_imported_key
    UNIQUE (source_label, imported_from)
);

COMMENT ON TABLE tracking_baselines IS
  'Push 4 — historical aggregate tracking records imported from legacy CSV. '
  'One row per sport-market label. Reference data only; never row-level. '
  'Idempotent on (source_label, imported_from).';

-- ─── 2. prediction_records ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_records (
  id                       BIGSERIAL PRIMARY KEY,
  game_prediction_id       BIGINT      NOT NULL REFERENCES game_predictions(id),
  game_id                  BIGINT      NOT NULL REFERENCES games(id),
  external_id              BIGINT      NOT NULL,
  sport                    TEXT        NOT NULL,
  slate_date               DATE        NOT NULL,
  game_date                TIMESTAMPTZ,
  matchup                  TEXT        NOT NULL,
  market                   TEXT        NOT NULL,        -- moneyline / total / first_inning
  pick                     TEXT,                        -- home / away / over / under / NRFI / YRFI
  side                     TEXT,
  line_value               NUMERIC,
  odds_american            INTEGER,
  odds_decimal             NUMERIC,
  model_used               TEXT,
  model_version            TEXT,
  prediction_source        TEXT,
  confidence               NUMERIC(5,2),
  model_probability        NUMERIC(7,6),
  market_probability       NUMERIC(7,6),
  edge                     NUMERIC(6,3),
  expected_value           NUMERIC(7,4),
  play_grade               TEXT,
  prediction_type          TEXT,
  best_angle               BOOLEAN     NOT NULL DEFAULT FALSE,
  no_bet                   BOOLEAN     NOT NULL DEFAULT FALSE,
  no_bet_reason            TEXT,
  market_aligned           BOOLEAN     NOT NULL DEFAULT FALSE,
  data_quality_tier        TEXT,
  source_quality           TEXT,
  provisional              BOOLEAN     NOT NULL DEFAULT FALSE,
  held                     BOOLEAN     NOT NULL DEFAULT FALSE,
  hold_reason              TEXT,
  launch_day               BOOLEAN     NOT NULL DEFAULT FALSE,
  manual_outcome_expected  BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at                TIMESTAMPTZ,
  published_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_json            JSONB,
  CONSTRAINT prediction_records_game_market_version_slate_key
    UNIQUE (game_id, market, model_version, slate_date)
);

CREATE INDEX IF NOT EXISTS prediction_records_slate_date_sport_idx
  ON prediction_records (slate_date, sport);
CREATE INDEX IF NOT EXISTS prediction_records_model_version_idx
  ON prediction_records (model_version);
CREATE INDEX IF NOT EXISTS prediction_records_best_angle_idx
  ON prediction_records (best_angle) WHERE best_angle = TRUE;

COMMENT ON TABLE prediction_records IS
  'Push 4 — immutable per-market prediction snapshots. One row per '
  '(game, market) at lock/publish time. Never modified after creation. '
  'Idempotent on (game_id, market, model_version, slate_date).';

-- ─── 3. prediction_grades ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_grades (
  id                          BIGSERIAL PRIMARY KEY,
  prediction_record_id        BIGINT      NOT NULL UNIQUE REFERENCES prediction_records(id),
  game_id                     BIGINT      NOT NULL REFERENCES games(id),
  market                      TEXT        NOT NULL,
  result                      TEXT        NOT NULL,    -- win / loss / push / void / pending
  push                        BOOLEAN     NOT NULL DEFAULT FALSE,
  win                         BOOLEAN     NOT NULL DEFAULT FALSE,
  loss                        BOOLEAN     NOT NULL DEFAULT FALSE,
  void                        BOOLEAN     NOT NULL DEFAULT FALSE,
  pending                     BOOLEAN     NOT NULL DEFAULT TRUE,
  actual_home_score           INTEGER,
  actual_away_score           INTEGER,
  actual_total                INTEGER,
  actual_first_inning_runs    INTEGER,
  winning_team                TEXT,                    -- home / away / null when push or void
  graded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grade_source                TEXT        NOT NULL,    -- auto_score_ingest / manual_operator / csv_import
  grade_notes                 TEXT
);

CREATE INDEX IF NOT EXISTS prediction_grades_result_idx
  ON prediction_grades (result);
CREATE INDEX IF NOT EXISTS prediction_grades_game_id_idx
  ON prediction_grades (game_id);

COMMENT ON TABLE prediction_grades IS
  'Push 4 — outcome row per prediction_records snapshot. Created after '
  'underlying game reaches status=final. NRFI/YRFI stay pending until '
  'first-inning score is available; never inferred from full-game total.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
