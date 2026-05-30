-- ─────────────────────────────────────────────────────────────────────────────
-- Oddsphere Lab — Database Schema (V2)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Source spec: planning-docs/01-database-schema.md
-- Status:      🔒 LOCKED (Day 5, 2026-05-22)
-- Target:      Supabase Postgres
-- Total:       23 tables across 8 categories
--
-- HOW TO USE:
--   1. Open Supabase Dashboard → SQL Editor → New query
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify all 23 tables appear in Table Editor
--
-- DESIGN NOTES:
--   • Column names mirror BALLDONTLIE / SharpAPI response shapes where possible
--     so mock-first build can swap mock → real providers with zero code changes.
--   • All `external_id` columns hold the upstream provider's id.
--   • Time columns use TIMESTAMPTZ (always UTC under the hood).
--   • Foreign keys use ON DELETE CASCADE where children should die with parent.
--   • CLV columns on game_predictions / prop_predictions / prediction_results
--     are populated at game-start; display is gated by ≥30 days of data minimum.
--
-- TABLE MANIFEST (in execution order — FK dependencies respected):
--   Reference (3):   teams · players · ballparks
--   Game data (4):   games · lineups · player_injuries · weather_forecasts
--   Stats (4):       player_season_stats · player_splits · pitcher_pitch_stats · hitter_pitch_stats
--   Betting (3):     lines · line_history · sharp_signals
--   Model output (3):game_predictions · prop_predictions · prediction_breakdowns
--   Tracking (2):    prediction_results · tracking_aggregates
--   User (2):        users · user_bet_pins
--   System (2):      data_refresh_log · calibration_buckets
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. REFERENCE DATA (teams · players · ballparks)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1.1 teams ──────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id                  BIGSERIAL PRIMARY KEY,
  external_id         INT  NOT NULL,                  -- BALLDONTLIE team id
  sport               TEXT NOT NULL,                  -- 'mlb', 'nba', 'nfl', etc.
  slug                TEXT NOT NULL,
  abbreviation        TEXT NOT NULL,                  -- 'NYY', 'LAD'
  display_name        TEXT NOT NULL,                  -- 'New York Yankees'
  short_display_name  TEXT NOT NULL,                  -- 'Yankees'
  name                TEXT NOT NULL,                  -- 'Yankees'
  location            TEXT NOT NULL,                  -- 'New York'
  league              TEXT,                           -- 'American' / 'National'
  division            TEXT,                           -- 'East' / 'Central' / 'West'
  logo_url            TEXT,
  primary_color       TEXT,                           -- Hex code for branding
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sport, external_id)
);

CREATE INDEX idx_teams_sport         ON teams (sport);
CREATE INDEX idx_teams_abbreviation  ON teams (sport, abbreviation);


-- ── 1.2 players ────────────────────────────────────────────────────────────
CREATE TABLE players (
  id            BIGSERIAL PRIMARY KEY,
  external_id   INT  NOT NULL,                        -- BALLDONTLIE player id
  mlb_person_id INT,                                  -- MLB AM Person ID (Phase 3.x first-inning enrichment); nullable, resolved via name+DOB match
  sport         TEXT NOT NULL,
  team_id       BIGINT REFERENCES teams(id),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  full_name     TEXT NOT NULL,                        -- 'Aaron Judge'
  jersey        TEXT,
  position      TEXT,                                 -- 'Right Fielder', etc.
  position_abbr TEXT,                                 -- 'RF', 'DH', 'SP', 'RP'
  is_pitcher    BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE,
  bats          TEXT,                                 -- 'L', 'R', 'S'
  throws        TEXT,                                 -- 'L', 'R'
  birth_place   TEXT,
  dob           DATE,
  age           INT,
  height        TEXT,
  weight        TEXT,
  debut_year    INT,
  draft         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sport, external_id)
);

CREATE INDEX idx_players_sport       ON players (sport);
CREATE INDEX idx_players_team        ON players (team_id);
CREATE INDEX idx_players_position    ON players (sport, position_abbr);
CREATE INDEX idx_players_is_pitcher  ON players (sport, is_pitcher);
CREATE INDEX idx_players_name        ON players (full_name);
-- Partial unique index — MLB Person IDs are globally unique within MLB
-- but the column is nullable while backfill is incremental.
CREATE UNIQUE INDEX idx_players_mlb_person_id_unique
  ON players (mlb_person_id) WHERE mlb_person_id IS NOT NULL;


-- ── 1.3 ballparks (MLB-specific for V1) ────────────────────────────────────
CREATE TABLE ballparks (
  id                              BIGSERIAL PRIMARY KEY,
  team_id                         BIGINT REFERENCES teams(id),
  name                            TEXT NOT NULL,     -- 'Yankee Stadium'
  city                            TEXT NOT NULL,
  state                           TEXT,
  is_dome                         BOOLEAN DEFAULT FALSE,
  is_retractable                  BOOLEAN DEFAULT FALSE,
  latitude                        DECIMAL(9,6),
  longitude                       DECIMAL(9,6),

  -- FanGraphs 3-yr rolling park factors (100 = neutral)
  park_factor_runs                DECIMAL(5,2),
  park_factor_hr                  DECIMAL(5,2),
  park_factor_hits                DECIMAL(5,2),
  park_factor_so                  DECIMAL(5,2),
  park_factor_handedness_lhh      DECIMAL(5,2),
  park_factor_handedness_rhh      DECIMAL(5,2),

  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ballparks_team ON ballparks (team_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. GAME DATA (games · lineups · player_injuries · weather_forecasts)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 2.1 games ──────────────────────────────────────────────────────────────
CREATE TABLE games (
  id                  BIGSERIAL PRIMARY KEY,
  external_id         INT  NOT NULL,                  -- BALLDONTLIE game id
  sport               TEXT NOT NULL,
  home_team_id        BIGINT REFERENCES teams(id),
  away_team_id        BIGINT REFERENCES teams(id),
  home_pitcher_id     BIGINT REFERENCES players(id),  -- Probable/starting pitcher
  away_pitcher_id     BIGINT REFERENCES players(id),
  ballpark_id         BIGINT REFERENCES ballparks(id),

  game_date           TIMESTAMPTZ NOT NULL,
  season              INT NOT NULL,
  season_type         TEXT,                           -- 'regular', 'postseason', 'spring_training'
  postseason          BOOLEAN DEFAULT FALSE,

  status              TEXT NOT NULL,                  -- 'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_FINAL'
  period              INT,                            -- Inning/quarter
  clock               TEXT,

  -- Results (populated when game finishes)
  home_score          INT,
  away_score          INT,
  home_hits           INT,
  away_hits           INT,
  home_errors         INT,
  away_errors         INT,
  total_runs          INT,                            -- Computed: home_score + away_score
  inning_scores       JSONB,                          -- {home: [0,1,4,...], away: [2,0,0,...]}

  -- NRFI/YRFI tracking
  first_inning_runs   INT,                            -- Set when 1st inning ends

  venue               TEXT,
  attendance          INT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sport, external_id)
);

CREATE INDEX idx_games_sport       ON games (sport);
CREATE INDEX idx_games_date        ON games (game_date);
CREATE INDEX idx_games_status      ON games (status);
CREATE INDEX idx_games_teams       ON games (home_team_id, away_team_id);
CREATE INDEX idx_games_sport_date  ON games (sport, game_date);


-- ── 2.2 lineups ────────────────────────────────────────────────────────────
CREATE TABLE lineups (
  id                BIGSERIAL PRIMARY KEY,
  game_id           BIGINT REFERENCES games(id)   ON DELETE CASCADE,
  team_id           BIGINT REFERENCES teams(id),
  player_id         BIGINT REFERENCES players(id),
  batting_position  INT,                              -- 1-9, NULL for pitcher in NL
  starting_position TEXT,                             -- 'C', '1B', '2B', ... or 'P'
  is_confirmed      BOOLEAN DEFAULT FALSE,
  is_dh             BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, team_id, player_id)
);

CREATE INDEX idx_lineups_game    ON lineups (game_id);
CREATE INDEX idx_lineups_player  ON lineups (player_id);


-- ── 2.3 player_injuries ────────────────────────────────────────────────────
CREATE TABLE player_injuries (
  id              BIGSERIAL PRIMARY KEY,
  player_id       BIGINT REFERENCES players(id) ON DELETE CASCADE,
  injury_date     TIMESTAMPTZ,
  return_date     TIMESTAMPTZ,
  type            TEXT,                               -- 'Shoulder', 'Knee', etc.
  detail          TEXT,                               -- 'Surgery', 'Strain', etc.
  side            TEXT,                               -- 'Left', 'Right'
  status          TEXT,                               -- 'Out', 'Day-to-Day', 'IL-10', etc.
  long_comment    TEXT,
  short_comment   TEXT,
  is_active       BOOLEAN DEFAULT TRUE,               -- False once player returns
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_injuries_player  ON player_injuries (player_id);
CREATE INDEX idx_injuries_active  ON player_injuries (is_active);


-- ── 2.4 weather_forecasts ──────────────────────────────────────────────────
CREATE TABLE weather_forecasts (
  id                          BIGSERIAL PRIMARY KEY,
  game_id                     BIGINT REFERENCES games(id) ON DELETE CASCADE,
  ballpark_id                 BIGINT REFERENCES ballparks(id),
  forecast_for                TIMESTAMPTZ NOT NULL,   -- When forecast IS for (game time)
  fetched_at                  TIMESTAMPTZ DEFAULT NOW(), -- When we pulled it

  temperature_f               INT,
  feels_like_f                INT,
  humidity_pct                INT,
  precipitation_mm            DECIMAL(5,2),
  precipitation_probability   INT,
  wind_speed_mph              INT,
  wind_direction_degrees      INT,
  wind_direction_relative     TEXT,                   -- 'out_to_lf', 'in_from_cf', etc.
  conditions                  TEXT,                   -- 'Clear', 'Rain', etc.

  -- Conditional-display flags (computed by cron)
  is_notable                  BOOLEAN DEFAULT FALSE,
  notable_reason              TEXT,                   -- 'wind_15mph_out', 'temp_45', 'rain_60pct'

  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_weather_game     ON weather_forecasts (game_id);
CREATE INDEX idx_weather_fetched  ON weather_forecasts (fetched_at DESC);


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. STATS (player_season_stats · player_splits · pitcher_pitch_stats · hitter_pitch_stats)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 3.1 player_season_stats ────────────────────────────────────────────────
CREATE TABLE player_season_stats (
  id                BIGSERIAL PRIMARY KEY,
  player_id         BIGINT REFERENCES players(id) ON DELETE CASCADE,
  team_id           BIGINT REFERENCES teams(id),
  season            INT  NOT NULL,
  season_type       TEXT NOT NULL,                    -- 'regular', 'postseason'
  postseason        BOOLEAN DEFAULT FALSE,

  -- Batting
  batting_gp        INT,
  batting_ab        INT,
  batting_r         INT,
  batting_h         INT,
  batting_avg       DECIMAL(5,4),
  batting_2b        INT,
  batting_3b        INT,
  batting_hr        INT,
  batting_rbi       INT,
  batting_tb        INT,
  batting_bb        INT,
  batting_so        INT,
  batting_sb        INT,
  batting_obp       DECIMAL(5,4),
  batting_slg       DECIMAL(5,4),
  batting_ops       DECIMAL(5,4),
  batting_war       DECIMAL(5,2),
  batting_pa        INT,                              -- Plate appearances
  batting_hbp       INT,
  batting_sf        INT,

  -- Pitching
  pitching_gp       INT,
  pitching_gs       INT,
  pitching_qs       INT,
  pitching_w        INT,
  pitching_l        INT,
  pitching_era      DECIMAL(5,2),
  pitching_sv       INT,
  pitching_hld      INT,
  pitching_ip       DECIMAL(5,1),                     -- Innings pitched
  pitching_h        INT,
  pitching_er       INT,
  pitching_hr       INT,
  pitching_bb       INT,
  pitching_whip     DECIMAL(5,3),
  pitching_k        INT,
  pitching_k_per_9  DECIMAL(5,2),
  pitching_war      DECIMAL(5,2),

  -- First-inning splits (Phase 3.x — sourced from MLB Stats API
  -- statSplits sitCode i01). innings_pitched stores converted decimal
  -- innings (e.g. 5.667 for the baseball notation "5.2"), NOT the raw
  -- baseball-notation string. starts is the sample-size gate input.
  first_inning_era             DECIMAL(5,2),
  first_inning_starts          INT,
  first_inning_runs_allowed    INT,
  first_inning_earned_runs     INT,
  first_inning_innings_pitched DECIMAL(5,3),
  first_inning_whip            DECIMAL(5,3),

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (player_id, season, season_type)
);

CREATE INDEX idx_season_stats_player         ON player_season_stats (player_id);
CREATE INDEX idx_season_stats_player_season  ON player_season_stats (player_id, season DESC);


-- ── 3.2 player_splits ──────────────────────────────────────────────────────
CREATE TABLE player_splits (
  id          BIGSERIAL PRIMARY KEY,
  player_id   BIGINT REFERENCES players(id) ON DELETE CASCADE,
  season      INT  NOT NULL,
  split_type  TEXT NOT NULL,                          -- 'vs_lhp', 'vs_rhp', 'home', 'away', 'day', 'night'

  -- Mirror season_stats but for this split
  ab          INT,
  h           INT,
  avg         DECIMAL(5,4),
  obp         DECIMAL(5,4),
  slg         DECIMAL(5,4),
  ops         DECIMAL(5,4),
  hr          INT,
  rbi         INT,
  so          INT,
  bb          INT,
  tb          INT,
  pa          INT,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (player_id, season, split_type)
);

CREATE INDEX idx_splits_player_season  ON player_splits (player_id, season DESC);
CREATE INDEX idx_splits_type           ON player_splits (split_type);


-- ── 3.3 pitcher_pitch_stats ────────────────────────────────────────────────
CREATE TABLE pitcher_pitch_stats (
  id              BIGSERIAL PRIMARY KEY,
  player_id       BIGINT REFERENCES players(id) ON DELETE CASCADE,
  season          INT  NOT NULL,
  pitch_type      TEXT NOT NULL,                      -- 'FF', 'SL', 'CU', 'CH', etc.

  count           INT,                                -- Number of pitches thrown
  pct_of_total    DECIMAL(5,2),                       -- % of total pitches
  avg_velo_mph    DECIMAL(5,2),
  whiff_rate      DECIMAL(5,2),
  k_rate          DECIMAL(5,2),
  contact_rate    DECIMAL(5,2),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (player_id, season, pitch_type)
);

CREATE INDEX idx_pitcher_pitch_stats_player  ON pitcher_pitch_stats (player_id, season DESC);


-- ── 3.4 hitter_pitch_stats ─────────────────────────────────────────────────
-- Hitter performance vs each pitch type. Mirrors pitcher_pitch_stats shape but
-- captures batting outcomes against pitch types (used by log5 matchup math).
CREATE TABLE hitter_pitch_stats (
  id              BIGSERIAL PRIMARY KEY,
  player_id       BIGINT REFERENCES players(id) ON DELETE CASCADE,
  season          INT  NOT NULL,
  pitch_type      TEXT NOT NULL,                      -- 'FF', 'SL', 'CU', 'CH', etc.

  pa              INT,                                -- Plate appearances vs this pitch
  ab              INT,
  h               INT,
  hr              INT,
  so              INT,
  bb              INT,
  avg             DECIMAL(5,4),
  slg             DECIMAL(5,4),
  ops             DECIMAL(5,4),
  whiff_rate      DECIMAL(5,2),                       -- % of swings that miss
  contact_rate    DECIMAL(5,2),                       -- % of swings that connect

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (player_id, season, pitch_type)
);

CREATE INDEX idx_hitter_pitch_stats_player  ON hitter_pitch_stats (player_id, season DESC);


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. BETTING DATA (lines · line_history · sharp_signals)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 4.1 lines (current betting odds) ───────────────────────────────────────
CREATE TABLE lines (
  id                    BIGSERIAL PRIMARY KEY,
  game_id               BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type           TEXT NOT NULL,                -- 'moneyline', 'spread', 'total', 'first_inning_total', 'prop_player_hits', etc.
  player_id             BIGINT REFERENCES players(id), -- NULL for game lines, populated for props
  sportsbook            TEXT NOT NULL,                -- 'draftkings', 'fanduel', 'pinnacle', etc.

  side                  TEXT,                         -- 'home', 'away', 'over', 'under', 'yes', 'no'
  line_value            DECIMAL(7,2),                 -- For totals/props: 8.5, 1.5, etc.
  odds_american         INT,                          -- -120, +160, etc.
  odds_decimal          DECIMAL(6,3),                 -- 1.833, 2.6, etc.
  implied_probability   DECIMAL(5,4),                 -- Computed

  -- SharpAPI built-in fields (already de-vigged vs Pinnacle)
  ev_percent            DECIMAL(5,2),
  fair_odds             INT,
  is_ev_positive        BOOLEAN,

  fetched_at            TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lines_game     ON lines (game_id);
CREATE INDEX idx_lines_market   ON lines (game_id, market_type);
CREATE INDEX idx_lines_player   ON lines (player_id, market_type);
CREATE INDEX idx_lines_book     ON lines (sportsbook);
CREATE INDEX idx_lines_fetched  ON lines (fetched_at DESC);


-- ── 4.2 line_history ───────────────────────────────────────────────────────
CREATE TABLE line_history (
  id              BIGSERIAL PRIMARY KEY,
  game_id         BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type     TEXT NOT NULL,
  player_id       BIGINT REFERENCES players(id),
  sportsbook      TEXT NOT NULL,
  side            TEXT,
  line_value      DECIMAL(7,2),
  odds_american   INT,
  is_opener       BOOLEAN DEFAULT FALSE,              -- Marks the opening line
  recorded_at     TIMESTAMPTZ NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_line_history_game      ON line_history (game_id, market_type);
CREATE INDEX idx_line_history_recorded  ON line_history (recorded_at DESC);


-- ── 4.3 sharp_signals ──────────────────────────────────────────────────────
CREATE TABLE sharp_signals (
  id                            BIGSERIAL PRIMARY KEY,
  game_id                       BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type                   TEXT NOT NULL,
  side                          TEXT NOT NULL,        -- 'home', 'away', 'over', 'under'

  -- Pinnacle reference + EV
  pinnacle_fair_probability     DECIMAL(5,4),
  is_plus_ev                    BOOLEAN DEFAULT FALSE,
  ev_pct                        DECIMAL(5,2),

  -- Steam moves
  has_steam_move                BOOLEAN DEFAULT FALSE,
  steam_detected_at             TIMESTAMPTZ,
  steam_books_count             INT,                  -- How many books moved together

  -- Reverse line movement
  has_reverse_line_movement     BOOLEAN DEFAULT FALSE,
  rlm_direction                 TEXT,                 -- 'home_money_line_to_away', etc.

  -- Public 'smoke' (breakdown-only, never on card)
  public_betting_pct            DECIMAL(5,2),
  public_money_pct              DECIMAL(5,2),

  -- Composite verdict
  signal_strength               TEXT,                 -- 'strong', 'caution', NULL
  signal_summary                TEXT,                 -- Plain English for breakdown

  computed_at                   TIMESTAMPTZ DEFAULT NOW(),
  created_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_game      ON sharp_signals (game_id);
CREATE INDEX idx_signals_strength  ON sharp_signals (signal_strength);


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. MODEL OUTPUT (game_predictions · prop_predictions · prediction_breakdowns)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 5.1 game_predictions (Daniel's scores model output) ────────────────────
-- CLV columns merged inline (the source doc adds them via ALTER at the end —
-- folded into CREATE TABLE here since we're starting from scratch).
CREATE TABLE game_predictions (
  id                      BIGSERIAL PRIMARY KEY,
  game_id                 BIGINT UNIQUE REFERENCES games(id) ON DELETE CASCADE,

  -- Predicted scores
  predicted_home_runs     DECIMAL(5,2),
  predicted_away_runs     DECIMAL(5,2),
  predicted_total         DECIMAL(5,2),

  -- ML pick
  predicted_ml_winner     TEXT,                       -- 'home' or 'away'
  ml_confidence           DECIMAL(5,2),               -- 0-100

  -- O/U pick
  predicted_ou_side       TEXT,                       -- 'over' or 'under'
  ou_confidence           DECIMAL(5,2),

  -- NRFI pick
  predicted_nrfi          BOOLEAN,                    -- TRUE = NRFI, FALSE = YRFI
  nrfi_confidence         DECIMAL(5,2),

  -- Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american       INT,                        -- Odds at pick time
  closing_odds_american   INT,                        -- Odds at game start
  clv_pct                 DECIMAL(5,2),               -- (bet_implied − closing_implied) × 100
  beat_closing_line       BOOLEAN,

  model_version           TEXT,                       -- Track which model produced this
  computed_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_game_predictions_game  ON game_predictions (game_id);


-- ── 5.2 prop_predictions (Our prop model's output) ─────────────────────────
CREATE TABLE prop_predictions (
  id                      BIGSERIAL PRIMARY KEY,
  game_id                 BIGINT REFERENCES games(id) ON DELETE CASCADE,
  player_id               BIGINT REFERENCES players(id) ON DELETE CASCADE,
  prop_market             TEXT NOT NULL,              -- 'batter_hits', 'batter_total_bases', 'pitcher_strikeouts', etc.
  prop_line               DECIMAL(5,2) NOT NULL,      -- 1.5, 7.5, etc.

  -- Model output
  model_probability       DECIMAL(5,4),               -- Our calculated probability of over
  fair_probability        DECIMAL(5,4),               -- De-vigged market (Pinnacle ref)
  edge_pct                DECIMAL(5,2),               -- model_prob − fair_prob (in pct points)

  -- Confidence
  confidence_score        DECIMAL(5,2),               -- 0-100 from 6-factor formula
  confidence_stars        INT,                        -- 1-5 (computed, hidden on card UI)
  tier                    TEXT,                       -- 'premium' (8%+), 'strong' (5-8%), 'good' (3-5%)

  -- Recommended bet
  best_sportsbook         TEXT,
  best_odds_american      INT,
  ev_pct                  DECIMAL(5,2),

  -- Reasoning
  reasoning               TEXT,                       -- 1-2 line explanation
  caveat                  TEXT,                       -- Optional warning (e.g., "edge >8%")

  -- Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american       INT,
  closing_odds_american   INT,
  clv_pct                 DECIMAL(5,2),
  beat_closing_line       BOOLEAN,

  model_version           TEXT,
  computed_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, player_id, prop_market, prop_line)
);

CREATE INDEX idx_prop_predictions_game      ON prop_predictions (game_id);
CREATE INDEX idx_prop_predictions_player    ON prop_predictions (player_id);
CREATE INDEX idx_prop_predictions_tier      ON prop_predictions (tier);
CREATE INDEX idx_prop_predictions_edge      ON prop_predictions (edge_pct DESC);
CREATE INDEX idx_prop_predictions_computed  ON prop_predictions (computed_at DESC);


-- ── 5.3 prediction_breakdowns ──────────────────────────────────────────────
CREATE TABLE prediction_breakdowns (
  id                              BIGSERIAL PRIMARY KEY,
  prop_prediction_id              BIGINT REFERENCES prop_predictions(id) ON DELETE CASCADE,

  -- Factor breakdown
  marcel_base_rate                DECIMAL(7,5),       -- Regressed base rate
  matchup_log5_rate               DECIMAL(7,5),       -- After log5 vs opposing pitcher
  park_adjustment                 DECIMAL(7,5),       -- After park factor
  weather_adjustment              DECIMAL(7,5),       -- After weather
  platoon_adjustment              DECIMAL(7,5),       -- After platoon
  recency_adjustment              DECIMAL(7,5),       -- After recency (small weight)

  expected_plate_appearances      DECIMAL(5,2),
  lineup_position                 INT,

  -- 6-factor confidence components
  reliability_score               DECIMAL(5,2),
  lineup_confirmation_score       DECIMAL(5,2),
  weather_certainty_score         DECIMAL(5,2),
  workload_certainty_score        DECIMAL(5,2),
  market_liquidity_score          DECIMAL(5,2),
  calibration_score               DECIMAL(5,2),

  created_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_breakdowns_prediction  ON prediction_breakdowns (prop_prediction_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. TRACKING (prediction_results · tracking_aggregates)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 6.1 prediction_results ─────────────────────────────────────────────────
CREATE TABLE prediction_results (
  id                      BIGSERIAL PRIMARY KEY,
  prediction_type         TEXT NOT NULL,              -- 'game_ml', 'game_total', 'game_nrfi', 'prop'
  game_prediction_id      BIGINT REFERENCES game_predictions(id),
  prop_prediction_id      BIGINT REFERENCES prop_predictions(id),

  outcome                 TEXT NOT NULL,              -- 'win', 'loss', 'push', 'void'
  actual_value            DECIMAL(7,2),               -- Actual hit count, actual total runs, etc.
  predicted_side          TEXT,                       -- 'home', 'over', 'nrfi', 'over_1.5_hits', etc.

  sport                   TEXT NOT NULL,
  market                  TEXT NOT NULL,              -- 'ml', 'total', 'nrfi', 'yrfi', 'prop_hits', etc.
  resolved_at             TIMESTAMPTZ DEFAULT NOW(),
  game_date               DATE NOT NULL,              -- For date filtering on Tracking page

  -- Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american       INT,                        -- Odds at pick time
  closing_odds_american   INT,                        -- Odds at game start
  clv_pct                 DECIMAL(5,2),               -- (bet_implied − closing_implied) × 100
  beat_closing_line       BOOLEAN,

  created_at              TIMESTAMPTZ DEFAULT NOW(),

  -- Exactly one of game_prediction_id / prop_prediction_id must be populated
  CHECK ((game_prediction_id IS NULL) <> (prop_prediction_id IS NULL))
);

CREATE INDEX idx_results_sport_market  ON prediction_results (sport, market);
CREATE INDEX idx_results_date          ON prediction_results (game_date DESC);
CREATE INDEX idx_results_outcome       ON prediction_results (outcome);
CREATE INDEX idx_results_clv           ON prediction_results (beat_closing_line) WHERE beat_closing_line IS NOT NULL;


-- ── 6.2 tracking_aggregates ────────────────────────────────────────────────
CREATE TABLE tracking_aggregates (
  id            BIGSERIAL PRIMARY KEY,
  sport         TEXT NOT NULL,
  market        TEXT NOT NULL,
  time_window   TEXT NOT NULL,                        -- 'yesterday', 'this_week', 'season', 'all_time'
  window_start  DATE,
  window_end    DATE,

  wins          INT NOT NULL DEFAULT 0,
  losses        INT NOT NULL DEFAULT 0,
  pushes        INT NOT NULL DEFAULT 0,
  total         INT NOT NULL DEFAULT 0,
  hit_rate      DECIMAL(5,2),

  computed_at   TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sport, market, time_window, window_start)
);

CREATE INDEX idx_aggregates_sport   ON tracking_aggregates (sport);
CREATE INDEX idx_aggregates_window  ON tracking_aggregates (time_window);


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. USER (users · user_bet_pins)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 7.1 users (Whop members) ───────────────────────────────────────────────
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_user_id         TEXT UNIQUE NOT NULL,
  email                TEXT,
  display_name         TEXT,
  membership_tier      TEXT,                          -- 'charter', 'standard', etc.
  membership_status    TEXT,                          -- 'active', 'cancelled', 'paused'
  joined_at            TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_whop    ON users (whop_user_id);
CREATE INDEX idx_users_status  ON users (membership_status);


-- ── 7.2 user_bet_pins (My Bets feature, V1.5) ──────────────────────────────
CREATE TABLE user_bet_pins (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             UUID   REFERENCES users(id) ON DELETE CASCADE,
  prediction_type     TEXT NOT NULL,
  game_prediction_id  BIGINT REFERENCES game_predictions(id),
  prop_prediction_id  BIGINT REFERENCES prop_predictions(id),
  pinned_at           TIMESTAMPTZ DEFAULT NOW(),
  notes               TEXT,                           -- Optional user notes

  -- Exactly one of game_prediction_id / prop_prediction_id must be populated
  CHECK ((game_prediction_id IS NULL) <> (prop_prediction_id IS NULL))
);

CREATE INDEX idx_pins_user  ON user_bet_pins (user_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- 8. SYSTEM (data_refresh_log · calibration_buckets)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 8.1 data_refresh_log ───────────────────────────────────────────────────
-- Powers "Updated N min ago" indicators across the Lab UI, plus rate-limit
-- tracking and the "How We Update" educational panel.
CREATE TABLE data_refresh_log (
  id                          BIGSERIAL PRIMARY KEY,
  data_source                 TEXT NOT NULL,          -- 'balldontlie_games', 'balldontlie_lineups',
                                                      -- 'balldontlie_props', 'sharpapi_lines',
                                                      -- 'sharpapi_sharp_signals', 'openweather',
                                                      -- 'fangraphs_park_factors', 'daniel_scores_model'
  sport                       TEXT,                   -- 'mlb', 'nba', etc. (NULL for cross-sport)

  refresh_started_at          TIMESTAMPTZ NOT NULL,
  refresh_completed_at        TIMESTAMPTZ,
  refresh_status              TEXT NOT NULL,          -- 'success', 'partial', 'failed', 'in_progress'

  records_updated             INT,                    -- How many rows touched
  api_calls_made              INT,                    -- For rate-limit tracking
  error_message               TEXT,

  scheduled_next_refresh      TIMESTAMPTZ,            -- When next refresh is planned

  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_log_source  ON data_refresh_log (data_source, refresh_started_at DESC);
CREATE INDEX idx_refresh_log_status  ON data_refresh_log (refresh_status);
CREATE INDEX idx_refresh_log_recent  ON data_refresh_log (refresh_started_at DESC);


-- ── 8.2 calibration_buckets ────────────────────────────────────────────────
-- Powers the "When we say 60% confidence, we hit X% of the time" credibility
-- display on the Tracking page. Recomputed weekly. Display gated by
-- is_displayable (sample size ≥ min_sample_size).
CREATE TABLE calibration_buckets (
  id                          BIGSERIAL PRIMARY KEY,
  sport                       TEXT NOT NULL,
  prediction_type             TEXT NOT NULL,          -- 'game_ml', 'game_total', 'prop'
  market                      TEXT,                   -- Optional finer granularity

  -- Bucket definition
  confidence_bucket_lower     DECIMAL(5,2),           -- e.g., 55.0
  confidence_bucket_upper     DECIMAL(5,2),           -- e.g., 60.0
  confidence_bucket_label     TEXT,                   -- '55-60%'

  -- Calibration data
  predictions_in_bucket       INT NOT NULL,           -- Sample size
  actual_hit_rate             DECIMAL(5,2),           -- What % actually hit
  expected_hit_rate           DECIMAL(5,2),           -- Midpoint of bucket
  calibration_delta           DECIMAL(5,2),           -- actual − expected (positive = overperforming)

  -- Display gating
  is_displayable              BOOLEAN DEFAULT FALSE,  -- Only show buckets with enough sample
  min_sample_size             INT DEFAULT 30,

  computed_at                 TIMESTAMPTZ DEFAULT NOW(),
  time_window                 TEXT,                   -- 'all_time', 'season', 'last_90_days'

  UNIQUE (sport, prediction_type, market, confidence_bucket_lower, time_window)
);

CREATE INDEX idx_calibration_sport         ON calibration_buckets (sport, prediction_type);
CREATE INDEX idx_calibration_displayable   ON calibration_buckets (is_displayable) WHERE is_displayable = TRUE;


-- ═════════════════════════════════════════════════════════════════════════════
-- 9. ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════════════
--
-- RLS enabled on all 23 tables (locked down by default — no policies yet).
-- The service_role key bypasses RLS, so server-side cron jobs and API routes
-- work normally. Browser-side access policies will be added in a later phase
-- once we're wiring up Whop auth + member reads.
--
-- Listed in the same order tables were created above (FK-dependency order).

ALTER TABLE teams                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE players                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ballparks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE games                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_injuries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_forecasts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_season_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_splits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitcher_pitch_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitter_pitch_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lines                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharp_signals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_predictions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_predictions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_breakdowns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_aggregates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bet_pins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_refresh_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_buckets    ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- END OF SCHEMA · 23 tables · RLS enabled · LOCKED 2026-05-22
-- ─────────────────────────────────────────────────────────────────────────────
