-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V23 — Add NHL team stats + goalie stats tables
-- (Phase 7L · NHL Daily Edge enablement)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file exists in the repo as the documented migration for the operator to
-- review BEFORE running it. Apply via the production apply plan at the bottom
-- of this file.
--
-- PHASE 7L — Add NHL into the existing Daily Edge pipeline (after MLB, NBA).
-- The NHL pipeline needs NHL-shaped team and goalie statistics. Existing
-- tables (`nba_team_ratings`, MLB pitching/lineup tables) don't fit the
-- hockey domain (xG%, Corsi/Fenwick, situation breakdown by 5on5/4on5/5on4,
-- per-goalie xGSAA equivalents) without lossy coercion or risking NBA
-- regression.
--
-- WHY TWO NEW TABLES
--   1. `nhl_team_stats` — MoneyPuck team CSV ingest. One row per
--      (team_id, season, season_type, situation). Captures xG/Corsi/Fenwick
--      plus per-situation context (5on5 = open ice; 5on4 = power play;
--      4on5 = penalty kill; "all" = mixed; "other" = empty net etc.)
--      The situation rows are how the model derives PP% × PK% differential
--      and pace.
--
--   2. `nhl_goalie_stats` — MoneyPuck goalie CSV ingest. One row per
--      (player_external_id, season, season_type, situation). Captures
--      expected vs actual goals against, save volume. xGSAA per 60 is
--      derived at read time from `(x_goals - goals) / icetime`.
--
-- SHAPE
--   Both tables are isolated NHL-only — they do NOT replace, alter, or
--   share constraints with `nba_team_ratings` or any MLB table. The
--   `teams` table is referenced by FK (existing sport='nhl' rows). No
--   existing tables are modified.
--
-- SAFETY
--   • Additive only — two new CREATE TABLE statements. Zero changes to
--     existing rows or constraints.
--   • Both tables have unique constraints (team_id + season + season_type
--     + situation) for idempotent upsert. Re-running the operator
--     refresh produces identical state.
--   • No data movement. Initial population happens via operator scripts
--     (Phase 1 of NHL build) reading MoneyPuck CSVs.
--   • Rollback is straightforward:
--       DROP TABLE nhl_goalie_stats;
--       DROP TABLE nhl_team_stats;
--     (No FKs from other tables point into these — they are leaf
--     reference data, read-only from the model side.)
--
-- COVERAGE NOTES
--   • Season convention follows MoneyPuck: start-year (e.g. 2025 = the
--     2025-26 season ending June 2026, currently the Stanley Cup Finals).
--   • Situation values exactly mirror MoneyPuck CSV: 'all', '5on5',
--     '4on5', '5on4', 'other'.
--   • season_type is 'regular' or 'playoffs'.
--   • Goalie player_external_id is MoneyPuck's playerId, which matches
--     NHL.com player ids — we can cross-reference if needed.
--
-- APPLY PLAN
--   1. Read the SQL block below in full.
--   2. From the operator's psql session against the production DB
--      (or the Supabase SQL editor):
--        \i lib/db/schema-migration-v23.sql
--   3. Verify both tables exist with the unique constraints:
--        \d+ nhl_team_stats
--        \d+ nhl_goalie_stats
--   4. No data populated yet — operator refresh scripts (Phase 1)
--      populate after this apply.
--   5. No rebuild required.
--
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS nhl_team_stats (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL,
  season_type TEXT NOT NULL,
  situation TEXT NOT NULL,
  games_played INTEGER,
  ice_time REAL,
  xgoals_pct REAL,
  corsi_pct REAL,
  fenwick_pct REAL,
  x_goals_for REAL,
  x_goals_against REAL,
  goals_for REAL,
  goals_against REAL,
  shots_on_goal_for REAL,
  shots_on_goal_against REAL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT nhl_team_stats_season_type_chk
    CHECK (season_type IN ('regular', 'playoffs')),
  CONSTRAINT nhl_team_stats_situation_chk
    CHECK (situation IN ('all', '5on5', '4on5', '5on4', 'other')),
  CONSTRAINT nhl_team_stats_unique
    UNIQUE (team_id, season, season_type, situation)
);

COMMENT ON TABLE nhl_team_stats IS
  'MoneyPuck team CSV stats by (team, season, season_type, situation). '
  'Powers the NHL Daily Edge model — xG%, Corsi/Fenwick, special teams '
  'differentials. Refreshed nightly by the NHL refresh-team-stats '
  'operator. Idempotent via unique constraint.';

CREATE INDEX IF NOT EXISTS nhl_team_stats_team_season_idx
  ON nhl_team_stats (team_id, season, season_type);


CREATE TABLE IF NOT EXISTS nhl_goalie_stats (
  id BIGSERIAL PRIMARY KEY,
  player_external_id BIGINT NOT NULL,
  player_name TEXT NOT NULL,
  team_abbr TEXT NOT NULL,
  season INTEGER NOT NULL,
  season_type TEXT NOT NULL,
  situation TEXT NOT NULL,
  games_played INTEGER,
  ice_time REAL,
  x_goals REAL,
  goals INTEGER,
  shots_against REAL,
  saves REAL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT nhl_goalie_stats_season_type_chk
    CHECK (season_type IN ('regular', 'playoffs')),
  CONSTRAINT nhl_goalie_stats_situation_chk
    CHECK (situation IN ('all', '5on5', '4on5', '5on4', 'other')),
  CONSTRAINT nhl_goalie_stats_unique
    UNIQUE (player_external_id, season, season_type, situation)
);

COMMENT ON TABLE nhl_goalie_stats IS
  'MoneyPuck per-goalie stats. Powers the NHL Daily Edge goalie advantage '
  'feature — xGSAA per 60 derived from (x_goals - goals) / icetime. '
  'Manual starting-goalie override (stored in games.sport_specific.nhl.'
  'starting_goalies) selects which row applies for a given game.';

CREATE INDEX IF NOT EXISTS nhl_goalie_stats_team_season_idx
  ON nhl_goalie_stats (team_abbr, season, season_type);

CREATE INDEX IF NOT EXISTS nhl_goalie_stats_name_idx
  ON nhl_goalie_stats (player_name);

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
