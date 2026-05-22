# Oddsphere Lab — Mock Data Shapes

**Status:** Day 5 design session (V2 — Corrected provider division)
**Purpose:** Define mock data that EXACTLY matches real API response shapes
**Critical Principle:** Mock data drives REAL model calculations, not hardcoded outputs

---

## 🚨 IMPORTANT: Provider Division Of Labor (CORRECTED)

| Data Type | Provider | Why |
|-----------|----------|-----|
| Teams, players, rosters | **BALLDONTLIE** | Best stats coverage |
| Player career stats (3 years) | **BALLDONTLIE** | Marcel needs historical |
| Player splits (vs LHP/RHP) | **BALLDONTLIE** | Detailed split data |
| Pitcher pitch type stats | **BALLDONTLIE** | Matchup detail |
| Lineups + batting order | **BALLDONTLIE** | Real-time lineups |
| Player injuries | **BALLDONTLIE** | Scratch detection |
| Games schedule | **BALLDONTLIE** | Slate data |
| **Game lines (ML/Total/NRFI)** | **SharpAPI** | Multi-book + Pinnacle fair |
| **Player prop lines** | **SharpAPI** | Multi-book + ev_percent |
| **Pinnacle fair reference** | **SharpAPI** | Built-in de-vig |
| **Line movement / history** | **SharpAPI** | Time-series odds |
| **Sharp signals** (steam, RLM, +EV) | **SharpAPI** | Detection logic |
| **Public betting splits** | **SharpAPI** | Smart vs public money |
| Weather forecasts | **OpenWeather** | Per-park forecasts |
| Park factors | **FanGraphs** | 3-yr rolling factors |

**Why this is right:** Each provider does what it's best at. BALLDONTLIE = stats/players. SharpAPI = lines/betting intel.

---

## Why Mock Data Shapes Matter

The whole mock-first approach depends on this being right.

❌ **Wrong way:** Invent fake data shapes, write code against them, then have to rewrite when real APIs arrive
✅ **Right way:** Mock shapes = real API shapes. Code never knows the difference. Flip a switch at launch.

---

## API Shape Verification (Day 5 Research)

### Confirmed BALLDONTLIE Patterns (For Stats)

**Universal Response Envelope:**
```json
{
  "data": [ { /* item */ }, ... ],
  "meta": {
    "per_page": 25,
    "next_cursor": "..."  // optional
  }
}
```

**Base URLs:**
- MLB: `https://api.balldontlie.io/mlb/v1/`
- Auth: `Authorization: YOUR_API_KEY` header

**Endpoints we use (stats-only):** teams, players, games, lineups, player_injuries, player_stats, player_splits, pitch_type_stats

**Standard MLB Game Stats Object:**
```json
{
  "id": 1423894,
  "player": {
    "id": 592450,
    "first_name": "Aaron",
    "last_name": "Judge",
    "position": "RF",
    "jersey_number": "99"
  },
  "team": {
    "id": 1,
    "abbreviation": "NYY",
    "city": "New York",
    "name": "Yankees"
  },
  "game": {
    "id": 18599100,
    "date": "2026-05-22",
    "status": "Scheduled"
  }
}
```

### Confirmed SharpAPI Patterns (For ALL Betting Data)

**Base URL:** `https://api.sharpapi.io/api/v1/`
**Auth:** `X-API-Key: sk_live_xxx` header

**Universal Response Envelope:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Yankees vs Tigers",
      "league": "MLB",
      "commence_time": "2026-05-22T23:10:00Z",
      "odds": [
        {
          "sportsbook": "draftkings",
          "market": "moneyline",
          "selection": "Yankees",
          "odds_american": -145,
          "ev_percent": 2.4,
          "fair_odds": -132,
          "is_ev_positive": true,
          "updated_at": "..."
        }
      ]
    }
  ],
  "meta": { ... }
}
```

**CRITICAL FEATURES (already calculated by SharpAPI):**
1. ✅ **`ev_percent` built-in** — de-vig vs Pinnacle done for us
2. ✅ **`fair_odds` provided** — no manual calculation needed
3. ✅ **`is_ev_positive` flag** — direct boolean for filtering
4. ✅ **Normalized across 32+ books** — consistent schema
5. ✅ **Pinnacle included** for sharp reference

### MLB Player Props Shape (SharpAPI)

```json
{
  "data": [
    {
      "event_id": "mlb_2026_05_22_nyy_det",
      "player_id": 592450,
      "player_name": "Aaron Judge",
      "team": "NYY",
      "market": "player_hits",
      "props": [
        {
          "sportsbook": "draftkings",
          "selection": "over",
          "line_value": 1.5,
          "odds_american": 160,
          "ev_percent": 5.2,
          "fair_odds": 142,
          "is_ev_positive": true,
          "updated_at": "2026-05-22T17:30:00.000Z"
        },
        {
          "sportsbook": "fanduel",
          "selection": "over",
          "line_value": 1.5,
          "odds_american": 145,
          "ev_percent": 3.8,
          "fair_odds": 142,
          "is_ev_positive": true,
          "updated_at": "2026-05-22T17:30:00.000Z"
        },
        {
          "sportsbook": "pinnacle",
          "selection": "over",
          "line_value": 1.5,
          "odds_american": 142,
          "ev_percent": 0.0,
          "fair_odds": 142,
          "is_ev_positive": false,
          "updated_at": "2026-05-22T17:30:00.000Z"
        }
      ]
    }
  ]
}
```

**Coverage caveat:** Per SharpAPI docs, MLB player prop coverage is "expanding." Verify exact prop markets available at trial time.

### Confirmed Vendor List (Sportsbooks via SharpAPI)
- draftkings
- fanduel
- caesars
- betmgm
- pinnacle (for fair reference)
- Plus 27+ more available

---

## Mock Data Scope (V1 Build Phase)

### What We Need For Mock-First Build

**Tonight's MLB slate:** 12 realistic games

**Full coverage of:**
- ✅ 30 MLB teams (all real)
- ✅ ~30 starting pitchers (one per team scheduled)
- ✅ 60 starting position players (12 games × 5 key bats per game we feature)
- ✅ 3 seasons of stats per player (2024, 2025, 2026)
- ✅ Realistic splits per player
- ✅ Confirmed lineups for tonight
- ✅ Weather for all 12 games (1-2 notable)
- ✅ Lines from 5 books per market
- ✅ Sharp signals on 3-4 games
- ✅ Daniel's scores model output for all 12
- ✅ ~40-50 player props
- ✅ 90 days historical results for Tracking page

### Mock Data Files (To Be Generated)

```
/app/lab/data/mocks/
├── teams.json                  (30 MLB teams)
├── players.json                (~90 active players for tonight's slate)
├── ballparks.json              (30 MLB venues with park factors)
├── games.json                  (12 games for tonight + 90 days historical)
├── lineups.json                (lineups for each tonight's game)
├── injuries.json               (5-10 current injuries)
├── weather.json                (weather forecasts per game)
├── player_season_stats.json    (3 seasons × ~90 players)
├── player_splits.json          (vs_lhp, vs_rhp splits per hitter)
├── pitcher_pitch_stats.json    (pitch types per pitcher)
├── lines.json                  (game lines from 5 books)
├── player_props.json           (~50 prop lines)
├── line_history.json           (opening + current per line)
├── sharp_signals.json          (3-4 games with sharp signals)
├── daniels_model.json          (scores model output for tonight)
├── historical_results.json     (90 days of W/L for tracking)
└── refresh_log.json            (mock refresh timestamps)
```

---

## DETAILED MOCK SHAPES BY TABLE

### 1. teams.json — 30 MLB Teams

```json
[
  {
    "external_id": 1,
    "sport": "mlb",
    "slug": "yankees",
    "abbreviation": "NYY",
    "display_name": "New York Yankees",
    "short_display_name": "Yankees",
    "name": "Yankees",
    "location": "New York",
    "league": "American",
    "division": "East",
    "logo_url": "https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png",
    "primary_color": "#003263"
  },
  {
    "external_id": 2,
    "sport": "mlb",
    "slug": "red-sox",
    "abbreviation": "BOS",
    "display_name": "Boston Red Sox",
    "short_display_name": "Red Sox",
    "name": "Red Sox",
    "location": "Boston",
    "league": "American",
    "division": "East",
    "logo_url": "https://a.espncdn.com/i/teamlogos/mlb/500/bos.png",
    "primary_color": "#BD3039"
  }
  // ... 28 more
]
```

### 2. players.json — ~90 Active Players

```json
[
  {
    "external_id": 592450,
    "sport": "mlb",
    "team_external_id": 1,
    "first_name": "Aaron",
    "last_name": "Judge",
    "full_name": "Aaron Judge",
    "jersey": "99",
    "position": "Right Fielder",
    "position_abbr": "RF",
    "is_pitcher": false,
    "active": true,
    "bats": "R",
    "throws": "R",
    "birth_place": "Linden, CA, USA",
    "dob": "1992-04-26",
    "age": 34,
    "height": "6' 7\"",
    "weight": "282 lbs",
    "debut_year": 2016
  },
  {
    "external_id": 543037,
    "sport": "mlb",
    "team_external_id": 1,
    "first_name": "Gerrit",
    "last_name": "Cole",
    "full_name": "Gerrit Cole",
    "jersey": "45",
    "position": "Starting Pitcher",
    "position_abbr": "SP",
    "is_pitcher": true,
    "active": true,
    "bats": "R",
    "throws": "R",
    "birth_place": "Newport Beach, CA, USA",
    "dob": "1990-09-08",
    "age": 35,
    "height": "6' 4\"",
    "weight": "220 lbs",
    "debut_year": 2013
  }
  // ... 88 more
]
```

### 3. ballparks.json — 30 MLB Venues

```json
[
  {
    "team_external_id": 1,
    "name": "Yankee Stadium",
    "city": "Bronx",
    "state": "NY",
    "is_dome": false,
    "is_retractable": false,
    "latitude": 40.8296,
    "longitude": -73.9262,
    "park_factor_runs": 103,
    "park_factor_hr": 109,
    "park_factor_hits": 101,
    "park_factor_so": 99,
    "park_factor_handedness_lhh": 110,
    "park_factor_handedness_rhh": 105
  },
  {
    "team_external_id": 14,
    "name": "Tropicana Field",
    "city": "St. Petersburg",
    "state": "FL",
    "is_dome": true,
    "is_retractable": false,
    "latitude": 27.7682,
    "longitude": -82.6534,
    "park_factor_runs": 97,
    "park_factor_hr": 95,
    "park_factor_hits": 99,
    "park_factor_so": 101,
    "park_factor_handedness_lhh": 96,
    "park_factor_handedness_rhh": 95
  }
  // ... 28 more
]
```

### 4. games.json — 12 Tonight + 90 days historical

```json
[
  {
    "external_id": 18599100,
    "sport": "mlb",
    "home_team_external_id": 1,
    "away_team_external_id": 5,
    "home_pitcher_external_id": 543037,
    "away_pitcher_external_id": 666749,
    "ballpark_external_id": 1,
    "game_date": "2026-05-22T23:10:00.000Z",
    "season": 2026,
    "season_type": "regular",
    "postseason": false,
    "status": "STATUS_SCHEDULED",
    "venue": "Yankee Stadium"
  }
  // ... 11 more tonight + 90 days of completed games
]
```

### 5. lineups.json — Lineups Per Game

```json
[
  {
    "game_external_id": 18599100,
    "team_external_id": 1,
    "player_external_id": 592450,
    "batting_position": 2,
    "starting_position": "RF",
    "is_confirmed": true,
    "is_dh": false
  },
  {
    "game_external_id": 18599100,
    "team_external_id": 1,
    "player_external_id": 543037,
    "batting_position": null,
    "starting_position": "P",
    "is_confirmed": true,
    "is_dh": false
  }
  // ... ~9 players per team × 24 teams = ~216 entries
]
```

### 6. injuries.json — 5-10 Active Injuries

```json
[
  {
    "player_external_id": 624413,
    "injury_date": "2026-05-15T00:00:00.000Z",
    "return_date": null,
    "type": "Hamstring",
    "detail": "Strain",
    "side": "Left",
    "status": "Day-to-Day",
    "long_comment": "Player is listed as day-to-day with a mild left hamstring strain.",
    "short_comment": "Hamstring strain",
    "is_active": true
  }
  // ... more
]
```

### 7. weather.json — Per-Game Weather

```json
[
  {
    "game_external_id": 18599100,
    "ballpark_external_id": 1,
    "forecast_for": "2026-05-22T23:10:00.000Z",
    "fetched_at": "2026-05-22T15:00:00.000Z",
    "temperature_f": 75,
    "feels_like_f": 76,
    "humidity_pct": 55,
    "precipitation_mm": 0.0,
    "precipitation_probability": 5,
    "wind_speed_mph": 8,
    "wind_direction_degrees": 90,
    "wind_direction_relative": "in_from_rf",
    "conditions": "Clear",
    "is_notable": false,
    "notable_reason": null
  },
  {
    "game_external_id": 18599105,
    "ballpark_external_id": 5,
    "forecast_for": "2026-05-22T23:10:00.000Z",
    "fetched_at": "2026-05-22T15:00:00.000Z",
    "temperature_f": 88,
    "feels_like_f": 92,
    "humidity_pct": 45,
    "precipitation_mm": 0.0,
    "precipitation_probability": 5,
    "wind_speed_mph": 14,
    "wind_direction_degrees": 220,
    "wind_direction_relative": "out_to_lf",
    "conditions": "Clear",
    "is_notable": true,
    "notable_reason": "wind_14mph_out_to_lf"
  }
  // ... 10 more
]
```

### 8. player_season_stats.json — 3 Seasons × ~90 Players

```json
[
  {
    "player_external_id": 592450,
    "team_external_id": 1,
    "season": 2024,
    "season_type": "regular",
    "postseason": false,
    "batting_gp": 158,
    "batting_ab": 559,
    "batting_r": 122,
    "batting_h": 180,
    "batting_avg": 0.322,
    "batting_2b": 36,
    "batting_3b": 1,
    "batting_hr": 58,
    "batting_rbi": 144,
    "batting_tb": 392,
    "batting_bb": 138,
    "batting_so": 171,
    "batting_sb": 10,
    "batting_obp": 0.458,
    "batting_slg": 0.701,
    "batting_ops": 1.159,
    "batting_war": 11.2,
    "batting_pa": 704,
    "batting_hbp": 4,
    "batting_sf": 3,
    "pitching_gp": null,
    "pitching_gs": null
    // ... other pitching fields null for batters
  },
  {
    "player_external_id": 592450,
    "season": 2025,
    "batting_h": 178,
    "batting_ab": 553,
    "batting_pa": 695,
    "batting_hr": 56,
    "batting_avg": 0.322
    // ... etc
  },
  {
    "player_external_id": 543037,
    "team_external_id": 1,
    "season": 2024,
    "season_type": "regular",
    "pitching_gp": 17,
    "pitching_gs": 17,
    "pitching_qs": 11,
    "pitching_w": 8,
    "pitching_l": 5,
    "pitching_era": 3.41,
    "pitching_sv": 0,
    "pitching_hld": 0,
    "pitching_ip": 95.0,
    "pitching_h": 75,
    "pitching_er": 36,
    "pitching_hr": 11,
    "pitching_bb": 33,
    "pitching_whip": 1.137,
    "pitching_k": 99,
    "pitching_k_per_9": 9.38,
    "pitching_war": 1.8
  }
  // ... more
]
```

### 9. player_splits.json — vs LHP / vs RHP per Hitter

```json
[
  {
    "player_external_id": 592450,
    "season": 2025,
    "split_type": "vs_lhp",
    "ab": 156,
    "h": 53,
    "avg": 0.340,
    "obp": 0.475,
    "slg": 0.769,
    "ops": 1.244,
    "hr": 18,
    "rbi": 42,
    "so": 38,
    "bb": 31,
    "tb": 120,
    "pa": 192
  },
  {
    "player_external_id": 592450,
    "season": 2025,
    "split_type": "vs_rhp",
    "ab": 397,
    "h": 125,
    "avg": 0.315,
    "obp": 0.450,
    "slg": 0.670,
    "ops": 1.120,
    "hr": 38,
    "rbi": 102,
    "so": 133,
    "bb": 107,
    "tb": 266,
    "pa": 503
  }
  // ... vs_lhp and vs_rhp per hitter
]
```

### 10. pitcher_pitch_stats.json

```json
[
  {
    "player_external_id": 543037,
    "season": 2025,
    "pitch_type": "FF",
    "count": 1234,
    "pct_of_total": 42.5,
    "avg_velo_mph": 96.3,
    "whiff_rate": 28.5,
    "k_rate": 18.2,
    "contact_rate": 71.5
  },
  {
    "player_external_id": 543037,
    "season": 2025,
    "pitch_type": "SL",
    "count": 745,
    "pct_of_total": 25.7,
    "avg_velo_mph": 87.2,
    "whiff_rate": 38.1,
    "k_rate": 25.4,
    "contact_rate": 61.9
  }
  // ... 4-6 pitch types per pitcher
]
```

### 11. lines.json — Game Lines From SharpAPI (Multi-Book + EV)

**Source:** SharpAPI `/api/v1/odds?league=MLB`
**Includes:** ML / Total / NRFI from all major books + Pinnacle + built-in EV

```json
[
  {
    "game_external_id": 18599100,
    "market_type": "moneyline",
    "player_external_id": null,
    "sportsbook": "draftkings",
    "selection": "home",
    "line_value": null,
    "odds_american": -145,
    "ev_percent": 2.4,
    "fair_odds": -132,
    "is_ev_positive": true,
    "implied_probability": 0.5918,
    "fetched_at": "2026-05-22T17:00:00.000Z"
  },
  {
    "game_external_id": 18599100,
    "market_type": "moneyline",
    "sportsbook": "fanduel",
    "selection": "home",
    "odds_american": -140,
    "ev_percent": 3.1,
    "fair_odds": -132,
    "is_ev_positive": true,
    "implied_probability": 0.5833,
    "fetched_at": "2026-05-22T17:00:00.000Z"
  },
  {
    "game_external_id": 18599100,
    "market_type": "moneyline",
    "sportsbook": "pinnacle",
    "selection": "home",
    "odds_american": -132,
    "ev_percent": 0.0,
    "fair_odds": -132,
    "is_ev_positive": false,
    "implied_probability": 0.5690,
    "fetched_at": "2026-05-22T17:00:00.000Z"
  },
  {
    "game_external_id": 18599100,
    "market_type": "total",
    "sportsbook": "draftkings",
    "selection": "over",
    "line_value": 8.5,
    "odds_american": -110,
    "ev_percent": 1.2,
    "fair_odds": -105,
    "is_ev_positive": true,
    "implied_probability": 0.5238,
    "fetched_at": "2026-05-22T17:00:00.000Z"
  },
  {
    "game_external_id": 18599100,
    "market_type": "first_inning_total",
    "sportsbook": "draftkings",
    "selection": "under",
    "line_value": 0.5,
    "odds_american": -130,
    "ev_percent": 2.8,
    "fair_odds": -118,
    "is_ev_positive": true,
    "implied_probability": 0.5652,
    "fetched_at": "2026-05-22T17:00:00.000Z"
  }
  // ... ML/Total/NRFI for each game × 5+ books each
]
```

**Key fields:**
- `ev_percent` — Already calculated by SharpAPI against Pinnacle no-vig
- `fair_odds` — Pinnacle's de-vigged line (our sharp reference)
- `is_ev_positive` — Boolean for quick filtering

### 12. player_props.json — Player Props From SharpAPI

**Source:** SharpAPI player props endpoint
**Coverage:** All 7 MLB markets (hits, total_bases, home_runs, rbis, strikeouts, earned_runs, hits_allowed)

```json
[
  {
    "event_external_id": "mlb_2026_05_22_nyy_det",
    "game_external_id": 18599100,
    "player_external_id": 592450,
    "player_name": "Aaron Judge",
    "team": "NYY",
    "market": "player_hits",
    "sportsbook": "draftkings",
    "selection": "over",
    "line_value": 1.5,
    "odds_american": 160,
    "ev_percent": 5.2,
    "fair_odds": 142,
    "is_ev_positive": true,
    "fetched_at": "2026-05-22T17:30:00.000Z"
  },
  {
    "event_external_id": "mlb_2026_05_22_nyy_det",
    "game_external_id": 18599100,
    "player_external_id": 592450,
    "player_name": "Aaron Judge",
    "team": "NYY",
    "market": "player_hits",
    "sportsbook": "fanduel",
    "selection": "over",
    "line_value": 1.5,
    "odds_american": 145,
    "ev_percent": 3.8,
    "fair_odds": 142,
    "is_ev_positive": true,
    "fetched_at": "2026-05-22T17:30:00.000Z"
  },
  {
    "event_external_id": "mlb_2026_05_22_nyy_det",
    "game_external_id": 18599100,
    "player_external_id": 592450,
    "player_name": "Aaron Judge",
    "team": "NYY",
    "market": "player_hits",
    "sportsbook": "pinnacle",
    "selection": "over",
    "line_value": 1.5,
    "odds_american": 142,
    "ev_percent": 0.0,
    "fair_odds": 142,
    "is_ev_positive": false,
    "fetched_at": "2026-05-22T17:30:00.000Z"
  },
  {
    "event_external_id": "mlb_2026_05_22_nyy_det",
    "game_external_id": 18599100,
    "player_external_id": 543037,
    "player_name": "Gerrit Cole",
    "team": "NYY",
    "market": "player_strikeouts",
    "sportsbook": "draftkings",
    "selection": "over",
    "line_value": 7.5,
    "odds_american": -120,
    "ev_percent": 4.1,
    "fair_odds": -135,
    "is_ev_positive": true,
    "fetched_at": "2026-05-22T17:30:00.000Z"
  }
  // ... ~50 entries covering all 7 prop markets × multiple books per player
]
```

**SharpAPI's MLB Market Type Strings (V1 build):**
- `player_hits` → batter_hits
- `player_total_bases` → batter_total_bases
- `player_home_runs` → batter_home_runs
- `player_rbis` → batter_rbis
- `player_strikeouts` → pitcher_strikeouts (or batter if marked)
- `player_earned_runs` → pitcher_earned_runs
- `player_hits_allowed` → pitcher_hits_allowed

### 13. line_history.json — Opening + Current

```json
[
  {
    "game_external_id": 18599100,
    "market_type": "moneyline",
    "player_external_id": null,
    "sportsbook": "pinnacle",
    "side": "home",
    "line_value": null,
    "odds_american": -135,
    "is_opener": true,
    "recorded_at": "2026-05-22T08:00:00.000Z"
  },
  {
    "game_external_id": 18599100,
    "market_type": "moneyline",
    "player_external_id": null,
    "sportsbook": "pinnacle",
    "side": "home",
    "line_value": null,
    "odds_american": -145,
    "is_opener": false,
    "recorded_at": "2026-05-22T17:00:00.000Z"
  }
  // ... open + current per market per game
]
```

### 14. sharp_signals.json — 3-4 Games

```json
[
  {
    "game_external_id": 18599105,
    "market_type": "moneyline",
    "side": "home",
    "pinnacle_fair_probability": 0.612,
    "is_plus_ev": true,
    "ev_pct": 4.2,
    "has_steam_move": true,
    "steam_detected_at": "2026-05-22T16:15:00.000Z",
    "steam_books_count": 4,
    "has_reverse_line_movement": false,
    "rlm_direction": null,
    "public_betting_pct": 38,
    "public_money_pct": 45,
    "signal_strength": "strong",
    "signal_summary": "Pinnacle fair + steam across 4 books + sharp money on home side despite public on away",
    "computed_at": "2026-05-22T17:00:00.000Z"
  }
  // ... 2-3 more with different signal types
]
```

### 15. daniels_model.json — Daniel's Output For Tonight

```json
[
  {
    "game_external_id": 18599100,
    "predicted_home_runs": 4.8,
    "predicted_away_runs": 3.2,
    "predicted_total": 8.0,
    "predicted_ml_winner": "home",
    "ml_confidence": 67.5,
    "predicted_ou_side": "under",
    "ou_confidence": 58.2,
    "predicted_nrfi": true,
    "nrfi_confidence": 64.8,
    "model_version": "daniels-v3.2",
    "computed_at": "2026-05-22T13:00:00.000Z"
  }
  // ... 11 more games
]
```

### 16. historical_results.json — 90 Days For Tracking Page

```json
[
  {
    "prediction_type": "game_ml",
    "outcome": "win",
    "predicted_side": "home",
    "sport": "mlb",
    "market": "ml",
    "resolved_at": "2026-05-21T23:30:00.000Z",
    "game_date": "2026-05-21",
    "bet_odds_american": -135,
    "closing_odds_american": -145,
    "clv_pct": 1.4,
    "beat_closing_line": true
  }
  // ... 90 days × ~5 picks/day = ~450 historical results
]
```

### 17. refresh_log.json — Mock Refresh Timestamps

```json
[
  {
    "data_source": "balldontlie_games",
    "sport": "mlb",
    "refresh_started_at": "2026-05-22T08:00:00.000Z",
    "refresh_completed_at": "2026-05-22T08:00:12.000Z",
    "refresh_status": "success",
    "records_updated": 12,
    "api_calls_made": 1,
    "scheduled_next_refresh": "2026-05-23T08:00:00.000Z"
  }
  // ... entries for each data source
]
```

---

## Mock Data Generation Strategy

### Approach: Realistic + Deterministic

We don't want random mocks that change every render. Instead:

1. **Use real player names** (Judge, Cole, Ohtani, etc.) — recognizable for testing
2. **Use realistic stats** (Judge's actual ~.300 AVG, 50+ HR pace)
3. **Realistic edge distribution:**
   - ~70% of props in 1-3% edge range (skip threshold)
   - ~15% in 3-5% (GOOD)
   - ~10% in 5-8% (STRONG)
   - ~3% in 8%+ (PREMIUM)
   - ~2% negative edges (filtered out)
4. **Deterministic seed** — same mocks every time, no flakiness

### File Structure for the Build

```
/app/lab/data/mocks/
├── seed.ts                     # Master seed function
├── teams.json
├── players.json
├── ballparks.json
├── games.json
├── lineups.json
├── injuries.json
├── weather.json
├── player_season_stats.json
├── player_splits.json
├── pitcher_pitch_stats.json
├── lines.json
├── player_props.json
├── line_history.json
├── sharp_signals.json
├── daniels_model.json
├── historical_results.json
└── refresh_log.json
```

---

## Open Questions / Decisions Still Needed

1. 🟡 **Exact volume of mock historical data** — 30 days vs 90 days vs full season?
2. 🟡 **Number of mock players** — 60 (just starters) vs 90 (some bench) vs 200 (full roster representation)?
3. 🟡 **How realistic should W/L ratios be in historical data** — match real tracking record numbers?
4. 🟡 **Mock data refresh** — Should we have multiple "states" of mocks for testing (pre-lineup vs post-lineup)?

---

## Next Steps

1. ✅ Document the mock shapes (this file)
2. 🟡 Generate the actual JSON files
3. 🟡 Move to build architecture design
4. 🟡 Define cron jobs in code form
5. 🟡 Write final spec document for Claude Code
