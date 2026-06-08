-- Phase 7B.0 — NBA team advanced ratings table.
--
-- Stores per-team season-wide and (separately) playoff advanced
-- ratings sourced from Basketball Reference (BBR). One row per
-- (team_id, season, season_type). The orchestrator-facing service
-- reads the most-recent row matching the requested season_type when
-- composing an NBA feature snapshot.
--
-- Scope:
--   • Reads: scripts/operator/nba/refresh-nba-team-ratings.ts (BBR scrape
--     + upsert), lib/services/nba/featureSnapshot.ts (model input).
--   • Writes: only via the refresh operator above, gated by
--     NBA_RATINGS_DB_WRITES_ENABLED=true + --apply (two-key gate).
--   • NEVER written by the slate cycle. NBA admin-only in v0b.
--
-- Source-attribution invariants:
--   • Every row stores source_url + fetched_at + source (= "basketball-reference"
--     for v0b). Future sources (e.g. a paid BDL Pro tier, NBA.com if we
--     get headers working) extend the source enum.
--   • A row is NEVER updated in-place without bumping fetched_at. The
--     refresh operator UPSERTs on (team_id, season, season_type) and
--     overwrites all rating columns + bumps fetched_at.
--
-- Apply order: this migration assumes:
--   • `teams` table exists with sport='nba' rows for the 2 Finals teams
--     (NY, SA) seeded via scripts/operator/nba/seed-nba-finals.ts.
--   • No existing nba_team_ratings table.

CREATE TABLE IF NOT EXISTS nba_team_ratings (
  id              BIGSERIAL PRIMARY KEY,
  team_id         BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season          INT NOT NULL,                           -- e.g. 2026
  season_type     TEXT NOT NULL CHECK (season_type IN ('regular', 'playoffs')),

  -- Advanced ratings (BBR per-possession team table)
  off_rating      NUMERIC(5,2),                            -- points / 100 possessions
  def_rating      NUMERIC(5,2),                            -- opp points / 100 possessions
  net_rating      NUMERIC(5,2),                            -- ORtg - DRtg
  pace            NUMERIC(5,2),                            -- possessions / 48 min

  -- Provenance (mandatory)
  source          TEXT NOT NULL DEFAULT 'basketball-reference',
  source_url      TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (team_id, season, season_type)
);

CREATE INDEX IF NOT EXISTS idx_nba_team_ratings_team_season
  ON nba_team_ratings (team_id, season, season_type);

-- Notes for future migrations:
--   • If we later need per-game splits (recent form), they belong in a
--     separate `nba_team_form` table keyed on (team_id, as_of_date),
--     not here. This table is for SEASON-WIDE aggregates.
--   • If we add a second source (e.g. nba.com), add a `source_id`
--     discriminator and broaden the UNIQUE constraint.
