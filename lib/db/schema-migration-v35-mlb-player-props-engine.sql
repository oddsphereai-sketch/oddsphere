-- V35: MLB player props engine foundation.
-- Idempotent Phase 1 schema only. Does not alter existing Daily Edge,
-- tracking, prediction_records, user, subscription, or lock-snapshot tables.

CREATE TABLE IF NOT EXISTS public.sportsbooks (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  region TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mlb_teams (
  id BIGSERIAL PRIMARY KEY,
  provider_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  abbreviation TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  league TEXT,
  division TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mlb_players (
  id BIGSERIAL PRIMARY KEY,
  provider_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  bats TEXT,
  throws TEXT,
  primary_position TEXT,
  birth_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_players_normalized_name ON public.mlb_players (normalized_name);
CREATE INDEX IF NOT EXISTS idx_mlb_players_provider_ids ON public.mlb_players USING GIN (provider_ids_json);

CREATE TABLE IF NOT EXISTS public.mlb_games (
  id BIGSERIAL PRIMARY KEY,
  provider_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  season INT NOT NULL,
  game_date DATE NOT NULL,
  scheduled_start TIMESTAMPTZ NOT NULL,
  home_team_id BIGINT REFERENCES public.mlb_teams(id),
  away_team_id BIGINT REFERENCES public.mlb_teams(id),
  venue TEXT,
  roof_status TEXT,
  game_status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_games_game_date ON public.mlb_games (game_date);
CREATE INDEX IF NOT EXISTS idx_mlb_games_provider_ids ON public.mlb_games USING GIN (provider_ids_json);

CREATE TABLE IF NOT EXISTS public.mlb_probable_pitchers (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  team_id BIGINT REFERENCES public.mlb_teams(id),
  player_id BIGINT REFERENCES public.mlb_players(id),
  status TEXT NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_probable_pitchers_game_asof ON public.mlb_probable_pitchers (game_id, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.mlb_lineups (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  team_id BIGINT REFERENCES public.mlb_teams(id),
  player_id BIGINT REFERENCES public.mlb_players(id),
  batting_order INT,
  position TEXT,
  lineup_status TEXT NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_lineups_game_team_asof ON public.mlb_lineups (game_id, team_id, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.mlb_injuries (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES public.mlb_players(id),
  team_id BIGINT REFERENCES public.mlb_teams(id),
  status TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  expected_return DATE,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_injuries_player_asof ON public.mlb_injuries (player_id, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.mlb_weather (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  temperature_f NUMERIC,
  wind_speed_mph NUMERIC,
  wind_direction TEXT,
  humidity_pct NUMERIC,
  precipitation_probability NUMERIC,
  air_density NUMERIC,
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_weather_game_asof ON public.mlb_weather (game_id, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.player_game_logs (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  player_id BIGINT REFERENCES public.mlb_players(id),
  team_id BIGINT REFERENCES public.mlb_teams(id),
  opponent_team_id BIGINT REFERENCES public.mlb_teams(id),
  game_date DATE NOT NULL,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_game_logs_player_date ON public.player_game_logs (player_id, game_date DESC);

CREATE TABLE IF NOT EXISTS public.statcast_pitches (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  pitcher_id BIGINT REFERENCES public.mlb_players(id),
  batter_id BIGINT REFERENCES public.mlb_players(id),
  pitch_timestamp TIMESTAMPTZ,
  inning INT,
  pitch_type TEXT,
  release_speed NUMERIC,
  release_spin_rate NUMERIC,
  pfx_x NUMERIC,
  pfx_z NUMERIC,
  plate_x NUMERIC,
  plate_z NUMERIC,
  description TEXT,
  event TEXT,
  launch_speed NUMERIC,
  launch_angle NUMERIC,
  estimated_woba_using_speedangle NUMERIC,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_statcast_pitches_pitcher_time ON public.statcast_pitches (pitcher_id, pitch_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.prop_markets (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL,
  market_key TEXT NOT NULL,
  market_name TEXT NOT NULL,
  player_id BIGINT REFERENCES public.mlb_players(id),
  game_id BIGINT REFERENCES public.mlb_games(id),
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_markets_game_player_key ON public.prop_markets (game_id, player_id, market_key, line);

CREATE TABLE IF NOT EXISTS public.prop_odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id BIGINT REFERENCES public.prop_markets(id),
  sportsbook_id BIGINT REFERENCES public.sportsbooks(id),
  side TEXT NOT NULL,
  line NUMERIC NOT NULL,
  american_odds INT NOT NULL,
  decimal_odds NUMERIC NOT NULL,
  implied_probability NUMERIC NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  snapshot_role TEXT NOT NULL DEFAULT 'current',
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.prop_odds_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_role TEXT NOT NULL DEFAULT 'current';

CREATE INDEX IF NOT EXISTS idx_prop_odds_snapshots_market_asof ON public.prop_odds_snapshots (market_id, as_of_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_prop_odds_snapshots_role ON public.prop_odds_snapshots (market_id, snapshot_role, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.prop_results (
  id BIGSERIAL PRIMARY KEY,
  market_key TEXT NOT NULL,
  player_id BIGINT REFERENCES public.mlb_players(id),
  game_id BIGINT REFERENCES public.mlb_games(id),
  result_value NUMERIC,
  over_won BOOLEAN,
  under_won BOOLEAN,
  push BOOLEAN NOT NULL DEFAULT FALSE,
  settlement_status TEXT NOT NULL,
  provider TEXT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_results_game_player_key ON public.prop_results (game_id, player_id, market_key);

CREATE TABLE IF NOT EXISTS public.feature_snapshots (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES public.mlb_games(id),
  player_id BIGINT REFERENCES public.mlb_players(id),
  market_key TEXT NOT NULL,
  line NUMERIC NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  feature_version TEXT NOT NULL,
  features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_availability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  leakage_guard_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_snapshots_lookup ON public.feature_snapshots (game_id, player_id, market_key, as_of_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.model_versions (
  id BIGSERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,
  market_key TEXT NOT NULL,
  version TEXT NOT NULL,
  train_start_date DATE,
  train_end_date DATE,
  validation_start_date DATE,
  validation_end_date DATE,
  feature_version TEXT NOT NULL,
  model_artifact_path TEXT,
  calibration_artifact_path TEXT,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_name_version ON public.model_versions (model_name, market_key, version);

CREATE TABLE IF NOT EXISTS public.prop_predictions (
  id BIGSERIAL PRIMARY KEY,
  model_version_id BIGINT REFERENCES public.model_versions(id),
  game_id BIGINT REFERENCES public.mlb_games(id),
  player_id BIGINT REFERENCES public.mlb_players(id),
  market_key TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  model_probability NUMERIC NOT NULL,
  fair_decimal_odds NUMERIC NOT NULL,
  fair_american_odds INT NOT NULL,
  feature_snapshot_id BIGINT REFERENCES public.feature_snapshots(id),
  prediction_timestamp TIMESTAMPTZ NOT NULL,
  explanation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_predictions_game_market ON public.prop_predictions (game_id, market_key, prediction_timestamp DESC);

-- If an older prop_predictions table already exists, CREATE TABLE IF NOT EXISTS
-- will not add the paper-trading columns. Keep this migration additive so it can
-- coexist with the existing member/admin props history table.
ALTER TABLE IF EXISTS public.prop_predictions
  ADD COLUMN IF NOT EXISTS model_version_id BIGINT REFERENCES public.model_versions(id),
  ADD COLUMN IF NOT EXISTS market_key TEXT,
  ADD COLUMN IF NOT EXISTS line NUMERIC,
  ADD COLUMN IF NOT EXISTS side TEXT,
  ADD COLUMN IF NOT EXISTS fair_decimal_odds NUMERIC,
  ADD COLUMN IF NOT EXISTS fair_american_odds INT,
  ADD COLUMN IF NOT EXISTS feature_snapshot_id BIGINT REFERENCES public.feature_snapshots(id),
  ADD COLUMN IF NOT EXISTS prediction_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS explanation_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.prop_edges (
  id BIGSERIAL PRIMARY KEY,
  prediction_id BIGINT REFERENCES public.prop_predictions(id),
  odds_snapshot_id BIGINT REFERENCES public.prop_odds_snapshots(id),
  sportsbook_id BIGINT REFERENCES public.sportsbooks(id),
  no_vig_market_probability NUMERIC,
  model_probability NUMERIC NOT NULL,
  edge NUMERIC,
  expected_value NUMERIC,
  stale_line_flag BOOLEAN NOT NULL DEFAULT FALSE,
  data_quality_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.recommended_bets (
  id BIGSERIAL PRIMARY KEY,
  edge_id BIGINT REFERENCES public.prop_edges(id),
  recommendation_status TEXT NOT NULL,
  confidence_tier TEXT NOT NULL,
  recommended_units NUMERIC NOT NULL DEFAULT 0,
  recommended_bankroll_fraction NUMERIC NOT NULL DEFAULT 0,
  reason_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  market_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  train_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  bet_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.backtest_results (
  id BIGSERIAL PRIMARY KEY,
  backtest_run_id BIGINT REFERENCES public.backtest_runs(id),
  market_key TEXT NOT NULL,
  sportsbook_id BIGINT REFERENCES public.sportsbooks(id),
  bets INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  pushes INT NOT NULL DEFAULT 0,
  units_won NUMERIC NOT NULL DEFAULT 0,
  roi NUMERIC NOT NULL DEFAULT 0,
  avg_ev NUMERIC,
  avg_edge NUMERIC,
  avg_clv NUMERIC,
  max_drawdown NUMERIC,
  brier_score NUMERIC,
  log_loss NUMERIC,
  calibration_error NUMERIC,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.data_quality_events (
  id BIGSERIAL PRIMARY KEY,
  severity TEXT NOT NULL,
  component TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_quality_events_component_created ON public.data_quality_events (component, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sportsbooks_name_unique ON public.sportsbooks (name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mlb_teams_abbreviation_unique ON public.mlb_teams (abbreviation);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_markets_unique_market ON public.prop_markets (sport, game_id, player_id, market_key, line, side);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_snapshots_unique_snapshot ON public.feature_snapshots (game_id, player_id, market_key, line, as_of_timestamp, feature_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_predictions_unique_prediction ON public.prop_predictions (game_id, player_id, market_key, line, side, prediction_timestamp);
