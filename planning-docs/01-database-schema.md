# Oddsphere Lab — Database Schema (V2 — LOCKED ✅)

**Status:** 🔒 LOCKED on Day 5 (May 22, 2026). Ready for mock data shape design and build.
**Target Database:** Supabase Postgres (free tier during build, Pro at launch)
**Schema Approach:** Designed to mirror BALLDONTLIE + SharpAPI response shapes for mock-first development
**Total Tables:** 23 (across 8 categories)

**Lock Decisions:**
- ✅ Data update cadence aligned (4am / 8am / 12pm / 3pm / 5pm + lineup watch + final-hour sweep)
- ✅ CLV tracking columns added — silent for 30 days minimum
- ✅ Calibration display table added — gated by min 30 sample size
- ✅ Data refresh log added — powers "Time Updated" indicators across UI
- ✅ All UI elements have corresponding data sources
- ✅ Mock-first compatible (all column names mirror real API shapes)
- ✅ Multi-sport extensible

---

## Design Philosophy

1. **Mirror real API shapes** — column names match BALLDONTLIE/SharpAPI field names where possible
2. **Mock data uses same schema** — flip data source, zero code changes
3. **Support all V1 use cases** — Daily Edge, Player Props, Tracking
4. **Built for 7 sports** — MLB first, but schema supports NBA/NFL/NHL/CBB/CFB/UCL
5. **Audit-trail mindset** — track everything (predictions, results, line history)

---

## Tables Overview

### Reference Data (rarely changes)
1. `teams` — All teams across all sports
2. `players` — All players across all sports
3. `ballparks` — MLB-specific venue data with park factors

### Game Data (daily updates)
4. `games` — All games (past and future)
5. `lineups` — Starting lineups per game
6. `player_injuries` — Active injury reports
7. `weather_forecasts` — Per-game weather data

### Stats Data (real-time)
8. `player_season_stats` — Season-by-season player stats (3 years for Marcel)
9. `player_splits` — Splits (vs LHP/RHP, home/away, etc.)
10. `pitcher_pitch_stats` — Pitch type stats for pitchers
11. `hitter_pitch_stats` — Pitch type stats for hitters

### Betting Data (high frequency updates)
12. `lines` — Current odds/lines (game lines + props)
13. `line_history` — Historical line movement
14. `sharp_signals` — Detected sharp signals (Pinnacle fair, steam moves, RLM)

### Model Output (computed by our system)
15. `game_predictions` — Daniel's scores model output per game
16. `prop_predictions` — Our model's player prop predictions
17. `prediction_breakdowns` — Detailed reasoning for each prediction

### Tracking (results)
18. `prediction_results` — Win/loss outcomes for tracking
19. `tracking_aggregates` — Pre-computed W/L totals (for fast Tracking page loads)

### User Data (V1+)
20. `users` — Whop members
21. `user_bet_pins` — Saved bets ("My Bets" feature)

### System Operations (NEW — Day 5)
22. `data_refresh_log` — Track when each data source last refreshed (for "Time Updated" indicator)
23. `calibration_buckets` — Pre-computed calibration data (for credibility display)

### Day 5 Additions To Existing Tables
- `prediction_results`: Added CLV columns (closing line value tracking — silent for 30 days)
- `prop_predictions`: Added CLV columns
- `game_predictions`: Added CLV columns

---

## Detailed Schema

### 1. `teams`

```sql
CREATE TABLE teams (
  id BIGSERIAL PRIMARY KEY,
  external_id INT NOT NULL,           -- BALLDONTLIE team id
  sport TEXT NOT NULL,                 -- 'mlb', 'nba', 'nfl', etc.
  slug TEXT NOT NULL,
  abbreviation TEXT NOT NULL,          -- 'NYY', 'LAD'
  display_name TEXT NOT NULL,          -- 'New York Yankees'
  short_display_name TEXT NOT NULL,    -- 'Yankees'
  name TEXT NOT NULL,                  -- 'Yankees'
  location TEXT NOT NULL,              -- 'New York'
  league TEXT,                         -- 'American' / 'National'
  division TEXT,                       -- 'East' / 'Central' / 'West'
  logo_url TEXT,
  primary_color TEXT,                  -- Hex code for branding
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(sport, external_id)
);

CREATE INDEX idx_teams_sport ON teams(sport);
CREATE INDEX idx_teams_abbreviation ON teams(sport, abbreviation);
```

---

### 2. `players`

```sql
CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  external_id INT NOT NULL,           -- BALLDONTLIE player id
  sport TEXT NOT NULL,
  team_id BIGINT REFERENCES teams(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,             -- 'Aaron Judge'
  jersey TEXT,
  position TEXT,                       -- 'Right Fielder', 'Designated Hitter', etc.
  position_abbr TEXT,                  -- 'RF', 'DH', 'SP', 'RP'
  is_pitcher BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  bats TEXT,                           -- 'L', 'R', 'S'
  throws TEXT,                         -- 'L', 'R'
  birth_place TEXT,
  dob DATE,
  age INT,
  height TEXT,
  weight TEXT,
  debut_year INT,
  draft TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(sport, external_id)
);

CREATE INDEX idx_players_sport ON players(sport);
CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_players_position ON players(sport, position_abbr);
CREATE INDEX idx_players_is_pitcher ON players(sport, is_pitcher);
CREATE INDEX idx_players_name ON players(full_name);
```

---

### 3. `ballparks` (MLB-specific for V1)

```sql
CREATE TABLE ballparks (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT REFERENCES teams(id),
  name TEXT NOT NULL,                  -- 'Yankee Stadium'
  city TEXT NOT NULL,
  state TEXT,
  is_dome BOOLEAN DEFAULT FALSE,
  is_retractable BOOLEAN DEFAULT FALSE,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),

  -- FanGraphs park factors (3-year rolling)
  park_factor_runs DECIMAL(5,2),       -- 100 = neutral
  park_factor_hr DECIMAL(5,2),
  park_factor_hits DECIMAL(5,2),
  park_factor_so DECIMAL(5,2),
  park_factor_handedness_lhh DECIMAL(5,2),
  park_factor_handedness_rhh DECIMAL(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ballparks_team ON ballparks(team_id);
```

---

### 4. `games`

```sql
CREATE TABLE games (
  id BIGSERIAL PRIMARY KEY,
  external_id INT NOT NULL,           -- BALLDONTLIE game id
  sport TEXT NOT NULL,
  home_team_id BIGINT REFERENCES teams(id),
  away_team_id BIGINT REFERENCES teams(id),
  home_pitcher_id BIGINT REFERENCES players(id),   -- Probable/starting pitcher
  away_pitcher_id BIGINT REFERENCES players(id),
  ballpark_id BIGINT REFERENCES ballparks(id),

  game_date TIMESTAMPTZ NOT NULL,      -- Game start time
  season INT NOT NULL,
  season_type TEXT,                    -- 'regular', 'postseason', 'spring_training'
  postseason BOOLEAN DEFAULT FALSE,

  status TEXT NOT NULL,                -- 'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_FINAL'
  period INT,                          -- Inning/quarter
  clock TEXT,                          -- Display clock

  -- Results (populated when game finishes)
  home_score INT,
  away_score INT,
  home_hits INT,
  away_hits INT,
  home_errors INT,
  away_errors INT,
  total_runs INT,                      -- Computed: home_score + away_score
  inning_scores JSONB,                 -- {home: [0,1,4,...], away: [2,0,0,...]}

  -- First inning data (for NRFI/YRFI tracking)
  first_inning_runs INT,               -- Set when 1st inning ends

  venue TEXT,
  attendance INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(sport, external_id)
);

CREATE INDEX idx_games_sport ON games(sport);
CREATE INDEX idx_games_date ON games(game_date);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_teams ON games(home_team_id, away_team_id);
CREATE INDEX idx_games_sport_date ON games(sport, game_date);
```

---

### 5. `lineups`

```sql
CREATE TABLE lineups (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id),
  player_id BIGINT REFERENCES players(id),
  batting_position INT,                -- 1-9
  starting_position TEXT,              -- 'C', '1B', '2B', etc. or 'P' for pitcher
  is_confirmed BOOLEAN DEFAULT FALSE,
  is_dh BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(game_id, team_id, player_id)
);

CREATE INDEX idx_lineups_game ON lineups(game_id);
CREATE INDEX idx_lineups_player ON lineups(player_id);
```

---

### 6. `player_injuries`

```sql
CREATE TABLE player_injuries (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
  injury_date TIMESTAMPTZ,
  return_date TIMESTAMPTZ,
  type TEXT,                           -- 'Shoulder', 'Knee', etc.
  detail TEXT,                         -- 'Surgery', 'Strain', etc.
  side TEXT,                           -- 'Left', 'Right'
  status TEXT,                         -- 'Out', 'Day-to-Day', 'IL-10', etc.
  long_comment TEXT,
  short_comment TEXT,
  is_active BOOLEAN DEFAULT TRUE,      -- False once player returns
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_injuries_player ON player_injuries(player_id);
CREATE INDEX idx_injuries_active ON player_injuries(is_active);
```

---

### 7. `weather_forecasts`

```sql
CREATE TABLE weather_forecasts (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  ballpark_id BIGINT REFERENCES ballparks(id),
  forecast_for TIMESTAMPTZ NOT NULL,   -- When the forecast is FOR (game time)
  fetched_at TIMESTAMPTZ DEFAULT NOW(), -- When we pulled the forecast

  -- Conditions
  temperature_f INT,
  feels_like_f INT,
  humidity_pct INT,
  precipitation_mm DECIMAL(5,2),
  precipitation_probability INT,
  wind_speed_mph INT,
  wind_direction_degrees INT,
  wind_direction_relative TEXT,        -- 'out_to_lf', 'in_from_cf', etc.
  conditions TEXT,                     -- 'Clear', 'Rain', etc.

  -- Game-impact flags (computed)
  is_notable BOOLEAN DEFAULT FALSE,    -- Triggers conditional weather display
  notable_reason TEXT,                 -- 'wind_15mph_out', 'temp_45', 'rain_60pct'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_weather_game ON weather_forecasts(game_id);
CREATE INDEX idx_weather_fetched ON weather_forecasts(fetched_at DESC);
```

---

### 8. `player_season_stats`

```sql
CREATE TABLE player_season_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id),
  season INT NOT NULL,
  season_type TEXT NOT NULL,           -- 'regular', 'postseason'
  postseason BOOLEAN DEFAULT FALSE,

  -- Batting
  batting_gp INT,
  batting_ab INT,
  batting_r INT,
  batting_h INT,
  batting_avg DECIMAL(5,4),
  batting_2b INT,
  batting_3b INT,
  batting_hr INT,
  batting_rbi INT,
  batting_tb INT,
  batting_bb INT,
  batting_so INT,
  batting_sb INT,
  batting_obp DECIMAL(5,4),
  batting_slg DECIMAL(5,4),
  batting_ops DECIMAL(5,4),
  batting_war DECIMAL(5,2),
  batting_pa INT,                      -- Plate appearances (computed if needed)
  batting_hbp INT,
  batting_sf INT,

  -- Pitching
  pitching_gp INT,
  pitching_gs INT,
  pitching_qs INT,
  pitching_w INT,
  pitching_l INT,
  pitching_era DECIMAL(5,2),
  pitching_sv INT,
  pitching_hld INT,
  pitching_ip DECIMAL(5,1),            -- Innings pitched
  pitching_h INT,
  pitching_er INT,
  pitching_hr INT,
  pitching_bb INT,
  pitching_whip DECIMAL(5,3),
  pitching_k INT,
  pitching_k_per_9 DECIMAL(5,2),
  pitching_war DECIMAL(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(player_id, season, season_type)
);

CREATE INDEX idx_season_stats_player ON player_season_stats(player_id);
CREATE INDEX idx_season_stats_player_season ON player_season_stats(player_id, season DESC);
```

---

### 9. `player_splits`

```sql
CREATE TABLE player_splits (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
  season INT NOT NULL,
  split_type TEXT NOT NULL,            -- 'vs_lhp', 'vs_rhp', 'home', 'away', 'day', 'night'

  -- Stats (mirror season_stats but for this split)
  ab INT,
  h INT,
  avg DECIMAL(5,4),
  obp DECIMAL(5,4),
  slg DECIMAL(5,4),
  ops DECIMAL(5,4),
  hr INT,
  rbi INT,
  so INT,
  bb INT,
  tb INT,
  pa INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(player_id, season, split_type)
);

CREATE INDEX idx_splits_player_season ON player_splits(player_id, season DESC);
CREATE INDEX idx_splits_type ON player_splits(split_type);
```

---

### 10. `pitcher_pitch_stats`

```sql
CREATE TABLE pitcher_pitch_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
  season INT NOT NULL,
  pitch_type TEXT NOT NULL,            -- 'FF', 'SL', 'CU', 'CH', etc.

  -- Pitch metrics
  count INT,                           -- Number of pitches thrown
  pct_of_total DECIMAL(5,2),           -- % of total pitches
  avg_velo_mph DECIMAL(5,2),
  whiff_rate DECIMAL(5,2),
  k_rate DECIMAL(5,2),
  contact_rate DECIMAL(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(player_id, season, pitch_type)
);

CREATE INDEX idx_pitcher_pitch_stats_player ON pitcher_pitch_stats(player_id, season DESC);
```

---

### 11. `lines` (current betting odds)

```sql
CREATE TABLE lines (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,           -- 'moneyline', 'spread', 'total', 'first_inning_total', 'prop_player_hits', etc.
  player_id BIGINT REFERENCES players(id),  -- NULL for game lines, populated for props
  sportsbook TEXT NOT NULL,            -- 'draftkings', 'fanduel', 'pinnacle', etc.

  -- Line details (varies by market_type)
  side TEXT,                           -- 'home', 'away', 'over', 'under', 'yes', 'no'
  line_value DECIMAL(7,2),             -- For totals/props: 8.5, 1.5, etc.
  odds_american INT,                   -- -120, +160, etc.
  odds_decimal DECIMAL(6,3),           -- 1.833, 2.6, etc.
  implied_probability DECIMAL(5,4),    -- Computed

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lines_game ON lines(game_id);
CREATE INDEX idx_lines_market ON lines(game_id, market_type);
CREATE INDEX idx_lines_player ON lines(player_id, market_type);
CREATE INDEX idx_lines_book ON lines(sportsbook);
CREATE INDEX idx_lines_fetched ON lines(fetched_at DESC);
```

---

### 12. `line_history`

```sql
CREATE TABLE line_history (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,
  player_id BIGINT REFERENCES players(id),
  sportsbook TEXT NOT NULL,
  side TEXT,
  line_value DECIMAL(7,2),
  odds_american INT,
  is_opener BOOLEAN DEFAULT FALSE,     -- Marks the opening line
  recorded_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_line_history_game ON line_history(game_id, market_type);
CREATE INDEX idx_line_history_recorded ON line_history(recorded_at DESC);
```

---

### 13. `sharp_signals`

```sql
CREATE TABLE sharp_signals (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,                  -- 'home', 'away', 'over', 'under'

  -- Signal types
  pinnacle_fair_probability DECIMAL(5,4),  -- De-vigged Pinnacle line
  is_plus_ev BOOLEAN DEFAULT FALSE,
  ev_pct DECIMAL(5,2),                 -- Expected value %

  has_steam_move BOOLEAN DEFAULT FALSE,
  steam_detected_at TIMESTAMPTZ,
  steam_books_count INT,               -- How many books moved together

  has_reverse_line_movement BOOLEAN DEFAULT FALSE,
  rlm_direction TEXT,                  -- 'home_money_line_to_away' etc.

  public_betting_pct DECIMAL(5,2),     -- 'public smoke' for breakdown only
  public_money_pct DECIMAL(5,2),

  -- Composite signal
  signal_strength TEXT,                -- 'strong', 'caution', null
  signal_summary TEXT,                 -- Plain English for breakdown

  computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_game ON sharp_signals(game_id);
CREATE INDEX idx_signals_strength ON sharp_signals(signal_strength);
```

---

### 14. `game_predictions` (Daniel's scores model output)

```sql
CREATE TABLE game_predictions (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE UNIQUE,

  -- Predicted scores
  predicted_home_runs DECIMAL(5,2),
  predicted_away_runs DECIMAL(5,2),
  predicted_total DECIMAL(5,2),

  -- ML pick
  predicted_ml_winner TEXT,            -- 'home' or 'away'
  ml_confidence DECIMAL(5,2),          -- 0-100

  -- O/U pick
  predicted_ou_side TEXT,              -- 'over' or 'under'
  ou_confidence DECIMAL(5,2),

  -- NRFI pick
  predicted_nrfi BOOLEAN,              -- TRUE = NRFI, FALSE = YRFI
  nrfi_confidence DECIMAL(5,2),

  -- Source
  model_version TEXT,                  -- Track which model produced this
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_game_predictions_game ON game_predictions(game_id);
```

---

### 15. `prop_predictions` (Our model's output)

```sql
CREATE TABLE prop_predictions (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
  prop_market TEXT NOT NULL,           -- 'batter_hits', 'batter_total_bases', 'pitcher_strikeouts', etc.
  prop_line DECIMAL(5,2) NOT NULL,     -- 1.5, 7.5, etc.

  -- Model output
  model_probability DECIMAL(5,4),      -- Our calculated probability of over
  fair_probability DECIMAL(5,4),       -- De-vigged market (Pinnacle ref)
  edge_pct DECIMAL(5,2),               -- model_prob - fair_prob (in pct points)

  -- Confidence
  confidence_score DECIMAL(5,2),       -- 0-100 from 6-factor formula
  confidence_stars INT,                -- 1-5 (display only)
  tier TEXT,                           -- 'premium' (8%+), 'strong' (5-8%), 'good' (3-5%)

  -- Recommended bet
  best_sportsbook TEXT,
  best_odds_american INT,
  ev_pct DECIMAL(5,2),

  -- Reasoning
  reasoning TEXT,                      -- 1-2 line explanation
  caveat TEXT,                         -- Optional warning (e.g., "edge >8%")

  -- Source
  model_version TEXT,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(game_id, player_id, prop_market, prop_line)
);

CREATE INDEX idx_prop_predictions_game ON prop_predictions(game_id);
CREATE INDEX idx_prop_predictions_player ON prop_predictions(player_id);
CREATE INDEX idx_prop_predictions_tier ON prop_predictions(tier);
CREATE INDEX idx_prop_predictions_edge ON prop_predictions(edge_pct DESC);
CREATE INDEX idx_prop_predictions_computed ON prop_predictions(computed_at DESC);
```

---

### 16. `prediction_breakdowns` (Detailed factors for any prediction)

```sql
CREATE TABLE prediction_breakdowns (
  id BIGSERIAL PRIMARY KEY,
  prop_prediction_id BIGINT REFERENCES prop_predictions(id) ON DELETE CASCADE,

  -- Factor breakdown
  marcel_base_rate DECIMAL(7,5),       -- Regressed base rate
  matchup_log5_rate DECIMAL(7,5),      -- After log5 vs opposing pitcher
  park_adjustment DECIMAL(7,5),        -- After park factor
  weather_adjustment DECIMAL(7,5),     -- After weather
  platoon_adjustment DECIMAL(7,5),     -- After platoon
  recency_adjustment DECIMAL(7,5),     -- After recency

  expected_plate_appearances DECIMAL(5,2),
  lineup_position INT,

  -- 6-factor confidence components
  reliability_score DECIMAL(5,2),
  lineup_confirmation_score DECIMAL(5,2),
  weather_certainty_score DECIMAL(5,2),
  workload_certainty_score DECIMAL(5,2),
  market_liquidity_score DECIMAL(5,2),
  calibration_score DECIMAL(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_breakdowns_prediction ON prediction_breakdowns(prop_prediction_id);
```

---

### 17. `prediction_results`

```sql
CREATE TABLE prediction_results (
  id BIGSERIAL PRIMARY KEY,
  prediction_type TEXT NOT NULL,       -- 'game_ml', 'game_total', 'game_nrfi', 'prop'
  game_prediction_id BIGINT REFERENCES game_predictions(id),
  prop_prediction_id BIGINT REFERENCES prop_predictions(id),

  -- Result
  outcome TEXT NOT NULL,               -- 'win', 'loss', 'push', 'void'
  actual_value DECIMAL(7,2),           -- Actual hit count, actual total runs, etc.
  predicted_side TEXT,                 -- 'home', 'over', 'nrfi', 'over_1.5_hits', etc.

  -- For tracking aggregation
  sport TEXT NOT NULL,
  market TEXT NOT NULL,                -- 'ml', 'total', 'nrfi', 'yrfi', 'prop_hits', etc.
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  game_date DATE NOT NULL,             -- For date filtering on Tracking page

  -- Day 5: Closing Line Value tracking (silent for 30 days, then evaluate display)
  bet_odds_american INT,               -- What odds we recommended at pick time
  closing_odds_american INT,           -- What odds were at game start
  clv_pct DECIMAL(5,2),                -- Computed: (bet_implied - closing_implied) * 100
  beat_closing_line BOOLEAN,           -- TRUE if our pick had better odds than close

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CHECK ((game_prediction_id IS NULL) <> (prop_prediction_id IS NULL))
);

CREATE INDEX idx_results_sport_market ON prediction_results(sport, market);
CREATE INDEX idx_results_date ON prediction_results(game_date DESC);
CREATE INDEX idx_results_outcome ON prediction_results(outcome);
CREATE INDEX idx_results_clv ON prediction_results(beat_closing_line) WHERE beat_closing_line IS NOT NULL;
```

---

### 18. `tracking_aggregates` (Pre-computed for fast loads)

```sql
CREATE TABLE tracking_aggregates (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL,
  market TEXT NOT NULL,
  time_window TEXT NOT NULL,           -- 'yesterday', 'this_week', 'season', 'all_time'
  window_start DATE,
  window_end DATE,

  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  pushes INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  hit_rate DECIMAL(5,2),

  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(sport, market, time_window, window_start)
);

CREATE INDEX idx_aggregates_sport ON tracking_aggregates(sport);
CREATE INDEX idx_aggregates_window ON tracking_aggregates(time_window);
```

---

### 19. `users` (Whop members)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_user_id TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  membership_tier TEXT,                -- 'charter', 'standard', etc.
  membership_status TEXT,              -- 'active', 'cancelled', 'paused'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_whop ON users(whop_user_id);
CREATE INDEX idx_users_status ON users(membership_status);
```

---

### 20. `user_bet_pins` ("My Bets" pinning feature)

```sql
CREATE TABLE user_bet_pins (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL,
  game_prediction_id BIGINT REFERENCES game_predictions(id),
  prop_prediction_id BIGINT REFERENCES prop_predictions(id),
  pinned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,                          -- Optional user notes

  CHECK ((game_prediction_id IS NULL) <> (prop_prediction_id IS NULL))
);

CREATE INDEX idx_pins_user ON user_bet_pins(user_id);
```

---

### 21. `data_refresh_log` (NEW Day 5 — for "Time Updated" indicator)

```sql
CREATE TABLE data_refresh_log (
  id BIGSERIAL PRIMARY KEY,
  data_source TEXT NOT NULL,           -- 'balldontlie_games', 'balldontlie_lineups',
                                       -- 'balldontlie_props', 'sharpapi_lines',
                                       -- 'sharpapi_sharp_signals', 'openweather',
                                       -- 'fangraphs_park_factors', 'daniel_scores_model'
  sport TEXT,                          -- 'mlb', 'nba', etc. (NULL for cross-sport)

  refresh_started_at TIMESTAMPTZ NOT NULL,
  refresh_completed_at TIMESTAMPTZ,
  refresh_status TEXT NOT NULL,        -- 'success', 'partial', 'failed', 'in_progress'

  records_updated INT,                 -- How many rows touched
  api_calls_made INT,                  -- For rate limit tracking
  error_message TEXT,                  -- If failed

  -- For status display
  scheduled_next_refresh TIMESTAMPTZ,  -- When next refresh is planned

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_log_source ON data_refresh_log(data_source, refresh_started_at DESC);
CREATE INDEX idx_refresh_log_status ON data_refresh_log(refresh_status);
CREATE INDEX idx_refresh_log_recent ON data_refresh_log(refresh_started_at DESC);
```

**Purpose:**
- Powers "Updated 3 min ago" indicators across the Lab
- Tracks API rate limit consumption
- Audit trail for debugging refresh failures
- Powers the "How We Update" educational panel timing display

**Query example for UI:**
```sql
-- Get latest refresh time for a data source
SELECT refresh_completed_at, refresh_status, scheduled_next_refresh
FROM data_refresh_log
WHERE data_source = 'balldontlie_props' AND sport = 'mlb'
ORDER BY refresh_started_at DESC
LIMIT 1;
```

---

### 22. `calibration_buckets` (NEW Day 5 — for credibility display)

```sql
CREATE TABLE calibration_buckets (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL,
  prediction_type TEXT NOT NULL,       -- 'game_ml', 'game_total', 'prop'
  market TEXT,                         -- Optional finer granularity

  -- Bucket definition
  confidence_bucket_lower DECIMAL(5,2), -- e.g., 55.0
  confidence_bucket_upper DECIMAL(5,2), -- e.g., 60.0
  confidence_bucket_label TEXT,         -- '55-60%'

  -- Calibration data
  predictions_in_bucket INT NOT NULL,   -- Sample size
  actual_hit_rate DECIMAL(5,2),         -- What % actually hit
  expected_hit_rate DECIMAL(5,2),       -- Midpoint of bucket
  calibration_delta DECIMAL(5,2),       -- actual - expected (positive = overperforming)

  -- For display gating
  is_displayable BOOLEAN DEFAULT FALSE, -- Only show buckets with enough sample
  min_sample_size INT DEFAULT 30,       -- Minimum predictions to display

  computed_at TIMESTAMPTZ DEFAULT NOW(),
  time_window TEXT,                     -- 'all_time', 'season', 'last_90_days'

  UNIQUE(sport, prediction_type, market, confidence_bucket_lower, time_window)
);

CREATE INDEX idx_calibration_sport ON calibration_buckets(sport, prediction_type);
CREATE INDEX idx_calibration_displayable ON calibration_buckets(is_displayable) WHERE is_displayable = TRUE;
```

**Purpose:**
- Powers the Calibration display on Tracking page
- Shows "When we say 60% confidence, we hit X% of the time"
- Real sharp credibility metric
- Computed weekly via cron job from prediction_results

**Display example:**
```
🎯 MODEL CALIBRATION (MLB ML, All-Time)

Confidence    Predicted    Actual    Delta
55-60%        57.5%        56.2%     -1.3%   ✓ Well-calibrated
60-65%        62.5%        63.4%     +0.9%   ✓ Well-calibrated
65-70%        67.5%        65.1%     -2.4%   ~ Slight overconfidence
70-75%        72.5%        74.8%     +2.3%   ✓ Well-calibrated

Calibration Grade: A-  (within 3% across all buckets)
```

---

## Also Update: `game_predictions` and `prop_predictions` — Add CLV columns

Add these columns to both `game_predictions` and `prop_predictions` tables:

```sql
ALTER TABLE game_predictions
  ADD COLUMN bet_odds_american INT,
  ADD COLUMN closing_odds_american INT,
  ADD COLUMN clv_pct DECIMAL(5,2),
  ADD COLUMN beat_closing_line BOOLEAN;

ALTER TABLE prop_predictions
  ADD COLUMN bet_odds_american INT,
  ADD COLUMN closing_odds_american INT,
  ADD COLUMN clv_pct DECIMAL(5,2),
  ADD COLUMN beat_closing_line BOOLEAN;
```

**Note:** CLV columns are populated at game start (when closing line is captured). Display gated by `is_displayable` rule (30+ days of data minimum).

---

## Day 5 Update Cadence — Schema Alignment

### Data Source → Refresh Cron Schedule

| Data Source | Frequency | Cron Window | Tables Touched |
|-------------|-----------|-------------|----------------|
| BALLDONTLIE Games | Daily 4am ET | One-shot | `games` |
| BALLDONTLIE Players | Daily 4am ET | One-shot | `players`, `player_injuries` |
| BALLDONTLIE Season Stats | Daily 4am ET | One-shot | `player_season_stats`, `player_splits` |
| FanGraphs Park Factors | Weekly Mon 4am ET | One-shot | `ballparks` |
| Daniel's Scores Model | Daily 8am ET | Manual upload | `game_predictions` |
| BALLDONTLIE Props | 8am / 12pm / 3pm / 5pm | Every refresh | `lines`, `prop_predictions` |
| SharpAPI Lines | 8am / 12pm / 3pm / 5pm | Every refresh | `lines`, `line_history` |
| SharpAPI Sharp Signals | 8am / 12pm / 3pm / 5pm | Every refresh | `sharp_signals` |
| OpenWeather | 12pm / 3pm / 5pm | 3x daily | `weather_forecasts` |
| BALLDONTLIE Lineups | 5pm + every 30min until games | Lineup window | `lineups` |
| Lineup Watch (final hour) | Every 15min in last hour | Pre-game burst | `lineups`, `player_injuries` |
| Calibration Recompute | Weekly Sun 3am ET | Aggregation job | `calibration_buckets` |
| Tracking Aggregates | Daily 3am ET (after games) | Aggregation job | `tracking_aggregates` |

### Cron Job Architecture (Preview)

Each entry in `data_refresh_log` gets created when a cron job runs. UI queries the most recent entry per data source to display "Updated N min ago" indicators.

---

## Open Questions Still To Resolve

1. ✅ **CLV columns** — DONE this session
2. ✅ **Calibration buckets** — DONE this session
3. ✅ **Data refresh log** — DONE this session
4. 🟡 **player_splits exact field names** — Need final API doc check
5. 🟡 **lineups exact field names** — Need final API doc check
6. 🟡 **prop_market enum values** — Need to confirm BALLDONTLIE strings
7. 🟡 **SharpAPI signal field names** — Need to verify
8. 🟡 **Park factors source format** — FanGraphs scraping approach
9. 🟡 **NBA/NFL extensibility** — Confirm schema flexibility (next session)

---

## Next Steps

### This Session (Day 5):
1. ✅ Refresh tracking added
2. ✅ Calibration table added
3. ✅ CLV columns added
4. 🟡 Final schema lock (after a review pass)

### Next Session (Day 6):
1. Mock data shape design
2. Verify schema against final API doc deep-dive
3. Begin build architecture planning

