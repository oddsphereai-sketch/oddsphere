# Oddsphere Lab — Cron Job Detailed Specifications

**Status:** Day 5 design session
**Purpose:** Exact step-by-step specs for every cron job in the system
**Platform:** Vercel Cron Jobs (built-in, no extra infrastructure)

---

## Cron Schedule Overview

All times in ET. Vercel Cron uses UTC, so adjust:
- 4am ET = 9am UTC (winter) / 8am UTC (summer DST)
- Use `America/New_York` timezone helper

### Daily Cron Schedule

| Time (ET) | Cron Job | Purpose |
|-----------|----------|---------|
| 4:00 AM | `daily-refresh` | Stats refresh + previous day's tracking |
| 8:00 AM | `morning-slate` | Today's games + initial predictions |
| 12:00 PM | `midday-refresh` | Lines + sharp signals + props refresh |
| 3:00 PM | `afternoon-refresh` | Lines + weather + props refresh |
| 5:00 PM | `evening-refresh` | Lines + lineup watch starts |
| 5:30 PM → game start | `lineup-watch` (every 30min) | Lineup drops, scratch detection |
| Game start -90min → start | `pregame-sweep` (every 15min) | Final action, last-minute injuries |
| Post-game | `post-game-results` | Resolve outcomes, capture CLV |

### Weekly Cron Schedule

| Day/Time (ET) | Cron Job | Purpose |
|---------------|----------|---------|
| Monday 4:00 AM | `weekly-park-factors` | Update FanGraphs park factors |
| Sunday 3:00 AM | `weekly-calibration` | Recompute calibration buckets |

### Manual Triggers

| Trigger | Endpoint | Purpose |
|---------|----------|---------|
| Daniel | `/api/manual/upload-scores-model` | Daniel uploads his daily scores model |

---

## Vercel Cron Configuration

### `vercel.json` Configuration

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-refresh",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/morning-slate",
      "schedule": "0 13 * * *"
    },
    {
      "path": "/api/cron/midday-refresh",
      "schedule": "0 17 * * *"
    },
    {
      "path": "/api/cron/afternoon-refresh",
      "schedule": "0 20 * * *"
    },
    {
      "path": "/api/cron/evening-refresh",
      "schedule": "0 22 * * *"
    },
    {
      "path": "/api/cron/lineup-watch",
      "schedule": "*/30 22-23 * * *"
    },
    {
      "path": "/api/cron/pregame-sweep",
      "schedule": "*/15 23 * * *"
    },
    {
      "path": "/api/cron/post-game-results",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/cron/weekly-park-factors",
      "schedule": "0 9 * * 1"
    },
    {
      "path": "/api/cron/weekly-calibration",
      "schedule": "0 8 * * 0"
    }
  ]
}
```

**Note:** Cron schedules in UTC. Above schedules account for EST (UTC-5). Adjust for DST.

### Cron Authentication

All cron routes protected with bearer token:

```typescript
// At top of every cron route
const authHeader = request.headers.get('Authorization')
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 })
}
```

---

## CRON JOB SPECIFICATIONS

### 1. `daily-refresh` (4am ET / 9am UTC)

**Purpose:** Refresh foundational data daily before the day's slate processing begins.

**File:** `/app/api/cron/daily-refresh/route.ts`

**Steps:**
```
1. Authenticate cron request (CRON_SECRET)
2. Log start: refreshLogger.start('daily_refresh')
3. Get yesterday's date

4. RESOLVE YESTERDAY'S RESULTS
   For each game from yesterday:
     a. Get final box scores (BALLDONTLIE)
     b. For each game_prediction: resolve ML/Total/NRFI outcomes
     c. For each prop_prediction: resolve outcome
     d. Capture closing line at game start (for CLV)
     e. Write to prediction_results table
     f. Update tracking_aggregates (recompute time windows)

5. REFRESH PLAYER ROSTERS
   a. Pull active players from BALLDONTLIE
   b. UPSERT into players table
   c. Update team assignments (trades, call-ups)

6. REFRESH SEASON STATS
   a. Pull 3 years of stats for all active players
   b. UPSERT into player_season_stats
   c. Pull splits (vs LHP/RHP)
   d. UPSERT into player_splits
   e. Pull pitcher pitch type stats
   f. UPSERT into pitcher_pitch_stats

7. REFRESH INJURIES
   a. Pull current injury report from BALLDONTLIE
   b. UPSERT into player_injuries
   c. Mark resolved injuries as is_active=false

8. Log complete: refreshLogger.complete('daily_refresh', success: true)
```

**Error Handling:**
- If any step fails, log to refreshLogger with `refresh_status='partial'` or `'failed'`
- Continue with other steps if possible
- Send alert email to admin on failure (V1.5)

**Estimated Runtime:** 30-60 seconds
**API Calls:** ~50-100 (well under limits)
**Tables Touched:** `prediction_results`, `tracking_aggregates`, `players`, `player_season_stats`, `player_splits`, `pitcher_pitch_stats`, `player_injuries`, `data_refresh_log`

---

### 2. `morning-slate` (8am ET / 1pm UTC)

**Purpose:** Pull today's game slate, opening lines, generate initial predictions.

**File:** `/app/api/cron/morning-slate/route.ts`

**Steps:**
```
1. Authenticate + log start
2. Get today's date

3. PULL TODAY'S GAMES
   a. Get today's MLB games (BALLDONTLIE)
   b. UPSERT into games table
   c. Assign probable pitchers to games
   d. Compute notable_reason flags later (after weather)

4. PULL OPENING LINES
   a. Get game lines for today's games (SharpAPI)
      - ML, Spread, Total, NRFI from all books
   b. INSERT into lines table (fetched_at = now)
   c. INSERT into line_history with is_opener=true
   d. Get player props for today's games (SharpAPI)
   e. INSERT into lines table (with ev_percent, fair_odds, is_ev_positive)

5. AWAIT DANIEL'S SCORES MODEL
   a. Check if scores model has been uploaded today
   b. If not, log warning and skip steps 6-7
   c. If yes, proceed

6. RUN GAME PREDICTIONS
   For each game today:
     a. Parse Daniel's scores model row
     b. UPSERT into game_predictions table
     c. Compute Daily Edge verdict (STRONG/CAUTION/neutral)
     d. Detect sharp signals (steam moves, RLM, +EV)
     e. INSERT into sharp_signals table

7. RUN PROP PREDICTIONS
   For each game today, for each player in expected lineup:
     a. Get player career stats (3 years) from DB
     b. Get player splits from DB
     c. Get pitcher pitch stats from DB
     d. Get current park from DB
     e. Get current weather forecast from DB (if available, else null)
     f. Get lineup position estimate (use previous game if not confirmed)
     g. For each prop market (hits, HR, TB, K, ER, etc.):
        i. Get current line + odds from lines table (SharpAPI source)
        ii. Run propModelOrchestrator.predict(...)
            - Marcel regression → base rate
            - Log5 matchup → matchup-adjusted
            - Context adjustments → park/weather/platoon
            - Distribution calc → probability
            - Compare to SharpAPI fair_odds → edge
            - Compute confidence score (6-factor)
            - Classify tier (PREMIUM/STRONG/GOOD/SKIP)
        iii. If tier != 'skip': UPSERT into prop_predictions
             - Include reasoning text
             - Include best sportsbook (highest EV)
             - Include caveat if edge > 8%
        iv. Write breakdown details to prediction_breakdowns

8. Log complete
```

**Error Handling:**
- If BALLDONTLIE fails: retry 3x with backoff, then log failure
- If SharpAPI fails: retry 3x, then log failure (we can still show predictions, just not edges)
- If Daniel's model not uploaded: defer prop predictions to next refresh

**Estimated Runtime:** 60-120 seconds
**API Calls:** ~50-80 (12 games × ~4 endpoints each)

---

### 3. `midday-refresh` (12pm ET / 5pm UTC)

**Purpose:** Refresh lines, sharp signals, re-run predictions with updated data.

**File:** `/app/api/cron/midday-refresh/route.ts`

**Steps:**
```
1. Authenticate + log start

2. REFRESH LINES
   a. Get current game lines (SharpAPI)
   b. Get current props (SharpAPI)
   c. Compare to last known lines in DB
   d. Where different: INSERT into lines, INSERT into line_history
   e. Update lines table with fetched_at = now

3. REFRESH SHARP SIGNALS
   a. Detect steam moves (multiple books moving simultaneously)
   b. Detect reverse line movement (line moves opposite of public)
   c. Check +EV flags from SharpAPI
   d. UPSERT into sharp_signals

4. RE-RUN PROP PREDICTIONS
   For props with notable line changes:
     a. Re-run propModelOrchestrator with new line
     b. UPDATE prop_predictions with new edge/tier

5. UPDATE DAILY EDGE VERDICTS
   For each game:
     a. Re-evaluate sharp signal strength
     b. UPDATE game_predictions verdicts if changed

6. Log complete
```

**Estimated Runtime:** 30-60 seconds
**API Calls:** ~30-50

---

### 4. `afternoon-refresh` (3pm ET / 8pm UTC)

**Purpose:** Lines refresh + first weather forecast for tonight's games.

**File:** `/app/api/cron/afternoon-refresh/route.ts`

**Steps:**
```
1. Authenticate + log start

2. REFRESH LINES (same as midday)

3. PULL WEATHER FORECASTS
   For each outdoor or retractable game today:
     a. Get ballpark lat/lng
     b. Pull weather forecast for game time (OpenWeather)
     c. Compute notable_reason:
        - wind_15mph_out (wind > 15mph blowing out)
        - wind_15mph_in (wind > 15mph blowing in)
        - temp_extreme_hot (temp > 90°F)
        - temp_extreme_cold (temp < 50°F)
        - rain (precipitation_probability > 50%)
     c. UPSERT into weather_forecasts

4. RE-RUN AFFECTED PROP PREDICTIONS
   For HR/TB props on outdoor games where weather is notable:
     a. Re-run with weather adjustment
     b. UPDATE prop_predictions

5. REFRESH SHARP SIGNALS (same as midday)

6. Log complete
```

**Estimated Runtime:** 30-60 seconds

---

### 5. `evening-refresh` (5pm ET / 10pm UTC)

**Purpose:** Final pre-lineup refresh, START lineup watch sequence.

**File:** `/app/api/cron/evening-refresh/route.ts`

**Steps:**
```
1. Authenticate + log start

2. REFRESH LINES (latest pricing before lineup drops)

3. REFRESH WEATHER (final forecast before games)

4. CHECK FOR LINEUP DROPS
   a. Query BALLDONTLIE lineups endpoint for each tonight's game
   b. If lineup confirmed: UPSERT into lineups (is_confirmed=true)
   c. If still pending: keep is_confirmed=false

5. RECOMPUTE PROPS WITH CONFIRMED LINEUPS
   For each prop where lineup is now confirmed:
     a. Use ACTUAL lineup position (not estimated)
     b. Re-run propModelOrchestrator
     c. UPDATE prop_predictions with new edge/tier
     d. Set confidence boost (lineup_confirmation_score)

6. CHECK FOR SCRATCHES
   For each player in expected lineup but NOT in confirmed:
     a. Set is_scratched flag on lineups entry
     b. KILL any prop_predictions for that player
        - DELETE from prop_predictions
        - Log to data_refresh_log

7. Log complete
```

**Estimated Runtime:** 60-90 seconds

---

### 6. `lineup-watch` (Every 30 minutes from 5pm until games start)

**Purpose:** Catch late lineup drops and scratches.

**File:** `/app/api/cron/lineup-watch/route.ts`

**Steps:**
```
1. Authenticate + log start

2. IDENTIFY PENDING GAMES
   a. Get all games starting within next 4 hours
   b. Filter: games where lineups not yet confirmed for both teams

3. POLL FOR LINEUPS
   For each pending game:
     a. Try BALLDONTLIE lineups endpoint
     b. If new data: UPSERT into lineups
     c. Trigger prop re-computation for that game's players

4. SCRATCH DETECTION
   For each previously-expected player now missing from lineup:
     a. Mark prop_predictions for that player as inactive
     b. Log scratch event
     c. Surface in UI as "Lineup Update" alert

5. Log complete (with games_processed count)
```

**Estimated Runtime:** 15-30 seconds per run

---

### 7. `pregame-sweep` (Every 15 minutes in final 90 minutes before game start)

**Purpose:** Final pre-game data sweep — sharp action, injuries, last-minute line moves.

**File:** `/app/api/cron/pregame-sweep/route.ts`

**Steps:**
```
1. Authenticate + log start

2. IDENTIFY GAMES IN PREGAME WINDOW
   Games starting in next 90 minutes (not yet started)

3. FINAL LINE PULL
   a. Get latest lines (SharpAPI)
   b. Detect any final line movements
   c. Update line_history

4. SHARP SIGNAL SWEEP
   a. Detect any new steam moves
   b. Detect reverse line movement
   c. UPDATE sharp_signals

5. INJURY/SCRATCH CHECK
   a. Final injury report pull
   b. Any new scratches → kill props

6. CAPTURE CLOSING PRICE PREPARATION
   For games starting in next 5 minutes:
     a. Snapshot current odds for our predictions
     b. Stage closing_odds_american (will be updated when game starts)

7. Log complete
```

**Estimated Runtime:** 20-40 seconds per run

---

### 8. `post-game-results` (Daily 1am ET / 6am UTC, after all games)

**Purpose:** Resolve all outcomes, compute CLV, update tracking.

**File:** `/app/api/cron/post-game-results/route.ts`

**Steps:**
```
1. Authenticate + log start

2. GET YESTERDAY'S GAMES
   All games where status='Final' from yesterday

3. RESOLVE GAME OUTCOMES
   For each game prediction:
     a. ML outcome (compare predicted_ml_winner to actual winner)
     b. Total outcome (over/under vs predicted)
     c. NRFI outcome (first inning runs = 0)
     d. INSERT into prediction_results with outcome

4. RESOLVE PROP OUTCOMES
   For each prop prediction:
     a. Get player's actual stat line from game
     b. Compare to prop_line (over/under)
     c. INSERT into prediction_results
     d. Update closing_odds_american (snapshot from pregame-sweep)
     e. Compute clv_pct = (bet_implied - closing_implied) × 100
     f. Set beat_closing_line boolean

5. UPDATE TRACKING AGGREGATES
   For each sport × market × time_window:
     a. Recompute wins/losses/pushes
     b. Recompute hit_rate
     c. UPSERT into tracking_aggregates

6. Log complete
```

**Estimated Runtime:** 60-120 seconds

---

### 9. `weekly-park-factors` (Monday 4am ET)

**Purpose:** Update FanGraphs park factors (slow-changing data).

**File:** `/app/api/cron/weekly-park-factors/route.ts`

**Steps:**
```
1. Authenticate + log start

2. SCRAPE FANGRAPHS
   a. Fetch FanGraphs park factors page
   b. Parse HTML for each ballpark
   c. Extract 3-yr rolling park factors

3. UPDATE BALLPARKS
   For each ballpark:
     a. UPDATE ballparks table with new park_factor_* columns

4. Log complete
```

**Estimated Runtime:** 30-60 seconds
**API Calls:** 1 web fetch (HTML scrape)

---

### 10. `weekly-calibration` (Sunday 3am ET)

**Purpose:** Recompute calibration buckets for credibility display.

**File:** `/app/api/cron/weekly-calibration/route.ts`

**Steps:**
```
1. Authenticate + log start

2. GATHER DATA
   For each sport × prediction_type × market:
     a. Get all prediction_results with confidence scores

3. BUCKET BY CONFIDENCE
   For each result:
     a. Find bucket (e.g., 55-60%, 60-65%, etc.)
     b. Count predictions in bucket
     c. Count actual wins in bucket
     d. Compute actual_hit_rate

4. UPDATE CALIBRATION BUCKETS
   For each bucket:
     a. UPSERT into calibration_buckets
     b. Compute calibration_delta = actual - expected
     c. Set is_displayable = (sample_size >= 30)

5. Log complete
```

**Estimated Runtime:** 30-90 seconds (depending on data volume)

---

### 11. `upload-scores-model` (Manual trigger, daily ~7-8am ET)

**Purpose:** Daniel manually uploads his scores model output for the day.

**File:** `/app/api/manual/upload-scores-model/route.ts`

**Method:** POST (Daniel uses a simple web form or paste tool)

**Body:** JSON or CSV with Daniel's model output

**Steps:**
```
1. Authenticate user (Daniel only — admin check)
2. Validate upload format
3. Parse rows:
   For each game row:
     a. Match game by team abbreviations + date
     b. Extract:
        - predicted_home_runs
        - predicted_away_runs
        - predicted_ml_winner
        - ml_confidence
        - predicted_ou_side
        - ou_confidence
        - predicted_nrfi
        - nrfi_confidence
4. UPSERT into game_predictions
5. Trigger downstream prop prediction recomputation
6. Return success + games processed count
```

---

## Error Handling Patterns

### Standard Pattern

```typescript
// Inside each cron route
import { refreshLogger } from '@/lib/services/refreshLogger'

export async function GET(request: Request) {
  // 1. Authenticate
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Start log
  const logId = await refreshLogger.start('cron_name')

  try {
    // 3. Run steps
    // ... actual work ...

    // 4. Complete log
    await refreshLogger.complete(logId, {
      success: true,
      records_updated: ...,
      api_calls_made: ...
    })

    return Response.json({ success: true })
  } catch (error) {
    // 5. Log failure
    await refreshLogger.complete(logId, {
      success: false,
      error_message: error.message
    })

    return Response.json({ error: error.message }, { status: 500 })
  }
}
```

### Per-Provider Retry Logic

```typescript
// In provider classes
async fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { headers: this.headers })
      if (res.ok) return res
      // 429 rate limit: wait and retry
      if (res.status === 429) {
        await sleep(Math.pow(2, i) * 1000)
        continue
      }
      // Other errors: throw
      throw new Error(`HTTP ${res.status}`)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await sleep(Math.pow(2, i) * 1000)
    }
  }
  throw new Error('Max retries exceeded')
}
```

---

## Monitoring & Observability

### Refresh Status Dashboard (V1.5)

A simple admin page showing:
- Last successful refresh per data source
- Error counts in last 24 hours
- API call counts (rate limit headroom)
- Cron job durations

### Alerting (V2)
- Email Daniel if any cron fails 3 times consecutively
- Email if API call counts approach rate limits
- Slack webhook for steam move detection (optional)

---

## Cron Job Testing Strategy

### Local Development
- Each cron route can be invoked manually via curl + CRON_SECRET
- Mock providers used during development (no API calls)
- Time mocking via env var (force "today is May 22")

### Staging Verification (Trial Phase)
- Flip USE_REAL_* env vars to true
- Run cron routes manually first (verify against real APIs)
- Then enable Vercel cron schedule
- Monitor data_refresh_log for issues

### Production Monitoring
- Vercel Logs dashboard
- data_refresh_log query for last successful refresh
- Alerting on consecutive failures

---

## API Call Budget (Per Day)

### BALLDONTLIE GOAT (600 req/min = 36K/hour)

| Cron | API Calls | Frequency |
|------|-----------|-----------|
| daily-refresh | ~80 | 1x/day |
| morning-slate | ~30 | 1x/day |
| evening-refresh | ~15 | 1x/day |
| lineup-watch | ~5 | 6x/day = 30 |
| **Daily total** | **~155** | Way under limit ✅ |

### SharpAPI Pro (TBD limits at trial)

| Cron | API Calls | Frequency |
|------|-----------|-----------|
| morning-slate | ~12 | 1x/day |
| midday-refresh | ~8 | 1x/day |
| afternoon-refresh | ~8 | 1x/day |
| evening-refresh | ~8 | 1x/day |
| lineup-watch | ~5 | 6x/day = 30 |
| pregame-sweep | ~5 | 6x/day = 30 |
| **Daily total** | **~96** | Should be well within Pro limits ✅ |

### OpenWeather Free (1M/month, 60/min)

| Cron | API Calls | Frequency |
|------|-----------|-----------|
| afternoon-refresh | ~10 | 1x/day |
| evening-refresh | ~10 | 1x/day |
| **Daily total** | **~20** | 600/month — easily within 1M ✅ |

---

## Cron Job Build Order

For Claude Code, build crons in this order:

1. ✅ Refresh logger service first (everything depends on it)
2. ✅ `daily-refresh` (foundational data)
3. ✅ `morning-slate` (the big one — pulls slate, runs models)
4. ✅ `post-game-results` (resolves outcomes — important for testing)
5. ✅ Mid-day refreshes (`midday`, `afternoon`, `evening`)
6. ✅ Lineup-watch + pregame-sweep
7. ✅ Weekly: park-factors + calibration
8. ✅ Manual: upload-scores-model

---

## Next Steps

1. ✅ Cron jobs documented (THIS FILE)
2. 🟡 Final spec document (ties everything together for Claude Code handoff)

**ONE more planning session and we're ready for build!**
