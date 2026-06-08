-- Phase 7C — NBA v1 model: Four Factors columns.
--
-- ADDITIVE migration. Adds 8 nullable columns to the existing
-- `nba_team_ratings` table for Dean Oliver's Four Factors per team
-- (offense + defense). Source: Basketball Reference `advanced-team`
-- table on /leagues/NBA_<season>.html and /playoffs/NBA_<season>.html.
--
-- Same row identity as before: (team_id, season, season_type). The
-- existing UNIQUE constraint covers regular vs playoffs.
--
-- All columns nullable so missing values do not break the model — the
-- v1 pipeline shrinks the Four Factors modifier toward 0 when any
-- factor is null.
--
-- Scope:
--   • Reads:  lib/services/nba/featureSnapshot.ts (hydrates into snapshot)
--   • Writes: scripts/operator/nba/refresh-nba-team-ratings.ts
--   • Does NOT touch MLB tables. Does NOT add NBA cron.

ALTER TABLE nba_team_ratings
  ADD COLUMN IF NOT EXISTS off_efg_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS off_tov_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS off_orb_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS off_ft_rate          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS def_efg_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS def_tov_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS def_drb_pct          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS def_ft_rate_allowed  NUMERIC(5,3);

-- Notes:
--   • BBR's `advanced-team` table publishes off_efg/tov/orb/ft_rate (the
--     four offensive factors) and opp_efg/opp_tov/drb/opp_ft_rate (the
--     four defensive equivalents). BBR's `drb_pct` is the defensive
--     rebound % — i.e. the percentage of available defensive rebounds
--     the team grabbed. We store it as `def_drb_pct`. The opponent ORB%
--     is its complement.
--   • Values are percentages stored as decimals (e.g. 0.553 = 55.3%) so
--     downstream code can use them directly as ratios without a /100.
--   • If BBR ever changes its column names, the BBR client's
--     parseAdvancedTable function should be updated; this schema is
--     stable.
