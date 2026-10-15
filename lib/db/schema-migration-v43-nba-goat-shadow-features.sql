-- NBA GOAT shadow feature capture (additive, no active-model behavior).
--
-- Each batch is an immutable as-of snapshot. Rows are intentionally stored
-- separately from nba_team_ratings so research cannot silently overwrite the
-- active Basketball Reference input or reinterpret an existing locked card.

CREATE TABLE IF NOT EXISTS nba_stat_capture_batches (
  id                    BIGSERIAL PRIMARY KEY,
  provider              TEXT NOT NULL CHECK (provider IN ('balldontlie')),
  release               TEXT NOT NULL,
  season                INT NOT NULL,
  season_type           TEXT NOT NULL CHECK (season_type IN ('regular', 'playoffs', 'ist')),
  as_of_date             DATE NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('in_progress', 'complete', 'failed')),
  fetched_at             TIMESTAMPTZ NOT NULL,
  completed_at           TIMESTAMPTZ,
  provider_requests      INT NOT NULL DEFAULT 0 CHECK (provider_requests >= 0),
  selections_requested  INT NOT NULL DEFAULT 0 CHECK (selections_requested >= 0),
  observation_count     INT NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  error_message          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, release, season, season_type, as_of_date)
);

CREATE TABLE IF NOT EXISTS nba_team_stat_observations (
  id                    BIGSERIAL PRIMARY KEY,
  batch_id              BIGINT NOT NULL REFERENCES nba_stat_capture_batches(id) ON DELETE RESTRICT,
  team_id               BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  provider_team_id      BIGINT NOT NULL,
  team_abbreviation     TEXT NOT NULL,
  category              TEXT NOT NULL,
  stat_type             TEXT NOT NULL,
  research_role         TEXT NOT NULL CHECK (research_role IN ('core', 'matchup', 'rotation_context', 'exploratory')),
  stats_json            JSONB NOT NULL,
  source_path           TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (batch_id, team_id, category, stat_type)
);

CREATE INDEX IF NOT EXISTS idx_nba_stat_capture_batches_lookup
  ON nba_stat_capture_batches (season, season_type, as_of_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_nba_team_stat_observations_team
  ON nba_team_stat_observations (team_id, batch_id);

ALTER TABLE nba_stat_capture_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_team_stat_observations ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies by design. Collection and research use the
-- service role; member readers cannot query raw provider payloads directly.
