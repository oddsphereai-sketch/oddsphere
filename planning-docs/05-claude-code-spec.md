# Oddsphere AI Lab — Claude Code Build Spec

**Status:** ✅ READY FOR BUILD
**Last Updated:** Day 5 evening — Planning Phase Complete
**Purpose:** Master handoff document for Claude Code to execute the Lab build

---

## 🎯 READ THIS FIRST

This is the master specification for building the Oddsphere AI Lab. It references 4 supporting documents that contain detailed specifications:

1. **00-FOUNDATION.md** — All locked decisions, brand voice, banned features
2. **01-database-schema.md** — Complete 23-table schema (LOCKED)
3. **02-mock-data-shapes.md** — Real API response shapes for mock data
4. **03-build-architecture.md** — File structure, provider pattern, build order
5. **04-cron-jobs.md** — All 11 cron job specifications

**You MUST read all 5 documents before starting any work.** They are the source of truth.

---

## 📋 PROJECT OVERVIEW

### What We're Building
**The Oddsphere AI Lab** — A premium sports betting research platform at `oddsphere-ruby.vercel.app/lab` (hidden route until launch).

### Four Main Pages
1. **Daily Edge** — Daily game picks with sharp signals, line movement, weather, lineups
2. **Player Props** — Statistical player prop predictions with edge tiers + search/filter
3. **Tracking** — Honest per-sport/per-market tracking with calibration display
4. **My Bets** — User-pinned predictions (V1.5)

### Sport Coverage V1
- ⚾ MLB (V1 active)
- 🏀 NBA, 🏈 NFL, 🏒 NHL, 🏀 CBB, 🏈 CFB, ⚽ UCL (selectors with "coming soon" states)

### Tech Stack
- **Frontend:** Next.js 16.2.6 (App Router, TypeScript, Tailwind v4)
- **Backend:** Vercel (hosting + cron) + Supabase (Postgres)
- **Data Sources:** BALLDONTLIE GOAT (stats) + SharpAPI Pro (betting) + OpenWeather (weather) + FanGraphs (park factors)

### Build Approach: MOCK-FIRST
Build entire system on mock data that mirrors real API shapes EXACTLY. Switch to real APIs via environment variables. **Mock data drives REAL model calculations, not hardcoded outputs.**

---

## 🚨 CRITICAL CONSTRAINTS

Before writing any code, internalize these:

### ✅ MUST DO
- Use TypeScript strict mode everywhere
- Mirror real API response shapes in mock data
- Implement provider abstraction pattern (mock vs real)
- Use Supabase as single source of truth for UI
- Run statistical models on REAL data (not hardcoded outputs)
- Log all cron job runs to `data_refresh_log` table
- Use `CRON_SECRET` bearer auth on all cron routes
- Use Tailwind v4 utility classes (existing setup)

### ❌ MUST NOT DO
- Hardcode prediction values in UI (model must calculate)
- Use "LOCK", "PASS/FADE", "hot streak" language anywhere
- Show worst-day callouts on Tracking
- Use stars on player prop cards (capper-coded)
- Show inflated edge percentages (max realistic ~10%)
- Show sport-level aggregate totals on Tracking
- Use sharp/line filters on Player Props (those belong to Daily Edge)
- Call external APIs directly from UI components
- Use `any` type in TypeScript (use `unknown` if truly unknown)

### 🎨 BRAND VOICE
- Honest tracking + transparent reasoning + calibrated confidence
- Math-based, not vibes-based
- Premium handicapping voice, NOT capper voice
- See FOUNDATION.md "Brand Voice Decisions" for full guidance

---

## 🗺️ BUILD PHASES OVERVIEW

The build is organized in 9 phases. Each phase has clear acceptance criteria.

### Phase 1: Foundation (Week 1)
Database schema, types, Supabase client, env vars, provider interfaces

### Phase 2: Mock Providers + Data (Week 1-2)
Generate all mock JSON files, implement all mock providers, factory pattern

### Phase 3: Statistical Models (Week 2-3)
Marcel regression, log5 matchup, distributions, edge calculator, confidence score

### Phase 4: Services + Cron Jobs (Week 3-4)
Service layer + all 11 cron job routes

### Phase 5: UI Wiring (Week 4-5)
Data hooks + wire components to Supabase data

### Phase 6: Polish + QA (Week 5-6)
Loading/empty/error states + end-to-end testing

### Phase 7: Trial Verification (Week 6-7)
Sign up for free trials, flip env vars, verify real data flows

### Phase 8: Launch Prep (Week 7-8)
Whop auth, backtest props, calibration validation

### Phase 9: LAUNCH 🚀
Production deploy, charter member announcement, monitoring

---

## 📦 PHASE 1: FOUNDATION

### Goal
Set up the project foundation so all subsequent phases can build on solid ground.

### Tasks

#### 1.1 Environment Setup
- [ ] Verify Node.js v24.15.0 is available
- [ ] Verify existing Next.js 16.2.6 + Tailwind v4 setup works
- [ ] Verify Supabase project exists at `jounoyrkcirgmyjccxll.supabase.co`
- [ ] Verify `.env.local` has Supabase keys

#### 1.2 Environment Variables
Create complete `.env.local` file with all variables from `03-build-architecture.md`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://jounoyrkcirgmyjccxll.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<existing>
SUPABASE_SERVICE_ROLE_KEY=<existing>

# Provider Switches (all false during build)
USE_REAL_STATS=false
USE_REAL_BETTING=false
USE_REAL_WEATHER=false
USE_REAL_PARK_FACTORS=false

# API Keys (empty during build, filled at trial)
BALLDONTLIE_API_KEY=
SHARPAPI_KEY=
OPENWEATHER_API_KEY=

# Cron Auth
CRON_SECRET=<generate-random-string>
```

Also create `.env.example` template (no real values).

#### 1.3 Database Schema Migration
Execute the full schema from `01-database-schema.md`:
- [ ] Run all CREATE TABLE statements in Supabase SQL Editor
- [ ] Verify all 23 tables created
- [ ] Verify all indexes created
- [ ] Save schema as `/lib/db/schema.sql` for version control

#### 1.4 TypeScript Types
Create types in `/lib/types/`:

```
/lib/types/
├── api/                    # External API response types
│   ├── balldontlie.ts      # BALLDONTLIE response shapes
│   ├── sharpapi.ts         # SharpAPI response shapes
│   ├── openweather.ts      # OpenWeather shapes
│   └── fangraphs.ts        # FanGraphs scrape shapes
├── domain/                 # Internal types
│   ├── Player.ts
│   ├── Game.ts
│   ├── Team.ts
│   ├── Ballpark.ts
│   ├── Lineup.ts
│   ├── Weather.ts
│   ├── Lines.ts
│   ├── Prediction.ts
│   ├── PropPrediction.ts
│   ├── SharpSignal.ts
│   ├── Tracking.ts
│   └── Calibration.ts
└── ui/                     # UI component prop types
    ├── DailyEdgeCardProps.ts
    ├── PlayerPropCardProps.ts
    ├── TrackingCardProps.ts
    └── RefreshIndicatorProps.ts
```

Reference `02-mock-data-shapes.md` for exact API field names.

#### 1.5 Supabase Client Setup
- [ ] Create `/lib/db/supabase.ts` (server-side client)
- [ ] Create `/lib/db/supabaseBrowser.ts` (client-side)
- [ ] Verify connection with a simple test query

#### 1.6 Provider Interfaces
Create the contract that mock + real providers will implement:

```
/lib/providers/interfaces/
├── IStatsProvider.ts        # BALLDONTLIE contract
├── IBettingProvider.ts      # SharpAPI contract
├── IWeatherProvider.ts      # OpenWeather contract
└── IParkFactorProvider.ts   # FanGraphs contract
```

See `03-build-architecture.md` for interface signatures.

### Phase 1 Acceptance Criteria
- [ ] All 23 tables exist in Supabase
- [ ] TypeScript types compile without errors
- [ ] Provider interfaces defined
- [ ] Environment variables documented
- [ ] Test Supabase query works
- [ ] No mock or real implementations yet — just contracts

---

## 📦 PHASE 2: MOCK PROVIDERS + DATA

### Goal
Build a complete mock data layer that mirrors real API shapes exactly. UI/models will use this for entire build phase.

### Tasks

#### 2.1 Generate Mock Data Files
Following exact shapes in `02-mock-data-shapes.md`, create:

```
/lib/providers/mock/mock-data/
├── teams.json                  (30 MLB teams)
├── players.json                (~90 active players)
├── ballparks.json              (30 MLB venues with park factors)
├── games.json                  (12 tonight + 90 days historical)
├── lineups.json                (lineups per game)
├── injuries.json               (5-10 current injuries)
├── weather.json                (forecasts per game)
├── player_season_stats.json    (3 seasons × ~90 players)
├── player_splits.json          (vs_lhp/vs_rhp per hitter)
├── pitcher_pitch_stats.json    (4-6 pitch types per pitcher)
├── lines.json                  (SharpAPI shape: ev_percent, fair_odds)
├── player_props.json           (~50 prop lines, all 7 markets)
├── line_history.json           (open + current per market)
├── sharp_signals.json          (3-4 games with signals)
├── daniels_model.json          (12 games for tonight)
├── historical_results.json     (90 days × ~5 picks/day)
└── refresh_log.json            (mock timestamps)
```

**Critical:**
- Use realistic player names (Judge, Cole, Ohtani, etc.)
- Use realistic stats (Judge ~.300 AVG, 50+ HR)
- Edge distribution: 70% in 1-3% (skip), 15% in 3-5% (GOOD), 10% in 5-8% (STRONG), 3% in 8%+ (PREMIUM), 2% negative
- Historical W/L should match Daniel's real lifetime numbers (~57% MLB ML, 69% NBA ML)
- ONE realistic state (post-lineup confirmed) for V1

#### 2.2 Implement Mock Providers

**MockStatsProvider** (`/lib/providers/mock/MockStatsProvider.ts`):
- Reads from teams.json, players.json, etc.
- Returns data in BALLDONTLIE shape
- Implements full IStatsProvider interface

**MockBettingProvider** (`/lib/providers/mock/MockBettingProvider.ts`):
- Reads from lines.json, player_props.json, sharp_signals.json, line_history.json
- Returns data in SharpAPI shape (with ev_percent, fair_odds, is_ev_positive)
- Implements full IBettingProvider interface

**MockWeatherProvider** (`/lib/providers/mock/MockWeatherProvider.ts`):
- Reads from weather.json
- Returns data in OpenWeather shape
- Implements full IWeatherProvider interface

**MockParkFactorProvider** (`/lib/providers/mock/MockParkFactorProvider.ts`):
- Reads from ballparks.json
- Returns park factor data
- Implements full IParkFactorProvider interface

#### 2.3 Factory Pattern
Create `/lib/providers/factory.ts`:

```typescript
export function getStatsProvider(): IStatsProvider {
  if (process.env.USE_REAL_STATS === 'true') {
    return new BallDontLieProvider({ apiKey: process.env.BALLDONTLIE_API_KEY! })
  }
  return new MockStatsProvider()
}

// ... same pattern for other providers
```

#### 2.4 Seed Database With Mocks
Create `/lib/db/seedMocks.ts`:
- Reads all mock JSON files
- INSERTs into Supabase tables
- Can be run manually during development
- Idempotent (can be re-run)

Add npm script: `"seed": "tsx lib/db/seedMocks.ts"`

### Phase 2 Acceptance Criteria
- [ ] All 17 mock JSON files exist with realistic data
- [ ] All 4 mock providers implemented and tested
- [ ] Factory pattern returns correct provider based on env vars
- [ ] `npm run seed` populates Supabase with mock data
- [ ] Manual test: query Supabase and see mock data flowing through provider abstraction

---

## 📦 PHASE 3: STATISTICAL MODELS

### Goal
Build the statistical engine that powers Player Props predictions. Must be MATHEMATICALLY SOUND, not hardcoded.

### Tasks

#### 3.1 Statistical Utilities
Create `/lib/models/props/distributions/`:

**binomial.ts:**
```typescript
// P(X >= k) where X ~ Binomial(n, p)
export function binomialProbabilityOver(
  n: number,
  p: number,
  threshold: number
): number {
  // Returns P(X >= threshold) using binomial CDF
}
```

**poisson.ts:**
```typescript
// P(X >= k) where X ~ Poisson(lambda)
export function poissonProbabilityOver(
  lambda: number,
  threshold: number
): number {
  // Returns P(X >= threshold) using Poisson CDF
}
```

**negativeBinomial.ts:**
```typescript
// For Total Bases (overdispersed count data)
export function negativeBinomialProbabilityOver(
  mean: number,
  variance: number,
  threshold: number
): number {
  // Returns P(X >= threshold)
}
```

#### 3.2 Marcel Regression
Create `/lib/models/props/marcelRegression.ts`:

```typescript
// 3-year weighted regression with 5/4/3 weights
export function marcelRegressedRate(
  stats: SeasonStats[],  // 3 most recent seasons
  leagueAverage: number,
  reliabilityConstant: number = 1200  // for hit rate; varies by stat
): number {
  // Weighted average: 5*current + 4*last + 3*two_years_ago
  const weightedNumerator = (5 * stats[0].hits) + (4 * stats[1].hits) + (3 * stats[2].hits)
  const weightedDenominator = (5 * stats[0].pa) + (4 * stats[1].pa) + (3 * stats[2].pa)
  const observedRate = weightedNumerator / weightedDenominator

  // Reliability shrinkage toward league average
  const reliability = weightedDenominator / (weightedDenominator + reliabilityConstant)

  return reliability * observedRate + (1 - reliability) * leagueAverage
}
```

#### 3.3 Log5 Matchup Math
Create `/lib/models/props/log5Matchup.ts`:

```typescript
// Bill James log5 formula: P(batter beats pitcher | batter, pitcher, league)
export function log5(
  batterRate: number,    // e.g., batter's regressed hit rate
  pitcherRate: number,   // e.g., pitcher's regressed allowed hit rate
  leagueRate: number     // league average hit rate
): number {
  const numerator = (batterRate * pitcherRate) / leagueRate
  const denominator = numerator + ((1 - batterRate) * (1 - pitcherRate) / (1 - leagueRate))
  return numerator / denominator
}
```

#### 3.4 Context Adjustments
Create `/lib/models/props/contextAdjustments.ts`:

```typescript
// Apply park factor, weather, platoon adjustments multiplicatively
export function applyParkFactor(rate: number, parkFactor: number): number {
  // parkFactor of 105 = 5% boost
  return rate * (parkFactor / 100)
}

export function applyWeatherAdjustment(
  rate: number,
  propType: 'hits' | 'hr' | 'k' | 'er',
  weather: WeatherForecast
): number {
  // Only HR is significantly weather-affected
  // Wind blowing out at 15+ mph boosts HR ~10-15%
  // Temp affects HR (warmer = more)
}

export function applyPlatoonAdjustment(
  rate: number,
  batterHand: 'L' | 'R' | 'S',
  pitcherHand: 'L' | 'R',
  splitRate: number
): number {
  // Use player's actual split if available, else generic platoon multiplier
}
```

#### 3.5 Confidence Score
Create `/lib/models/props/confidenceScore.ts`:

```typescript
// 6-factor weighted confidence (0-100)
export function computeConfidence(factors: {
  reliability: number,       // 0-1 (sample size)
  lineupConfirmed: boolean,
  weatherCertainty: number,  // 0-1
  workloadCertainty: number, // 0-1 (pitcher rest, injury status)
  marketLiquidity: number,   // 0-1 (multiple books = higher)
  calibration: number        // 0-1 (historical accuracy)
}): { score: number, stars: number } {
  // Weighted average with documented weights
  // Map to 1-5 stars for internal use (UI hides stars)
}
```

#### 3.6 Edge Calculator
Create `/lib/models/props/edgeCalculator.ts`:

```typescript
// Compare our probability to SharpAPI's fair_odds (already de-vigged)
export function calculateEdge(
  modelProbability: number,
  fairOdds: number  // From SharpAPI (Pinnacle de-vigged)
): { edgePct: number, fairProbability: number } {
  const fairProbability = americanOddsToImpliedProbability(fairOdds)
  const edgePct = (modelProbability - fairProbability) * 100
  return { edgePct, fairProbability }
}
```

#### 3.7 Tier Classifier
Create `/lib/models/props/tierClassifier.ts`:

```typescript
export function classifyTier(edgePct: number): 'premium' | 'strong' | 'good' | 'skip' {
  if (edgePct >= 8) return 'premium'
  if (edgePct >= 5) return 'strong'
  if (edgePct >= 3) return 'good'
  return 'skip'  // not surfaced
}
```

#### 3.8 Prop Model Orchestrator
Create `/lib/models/props/propModelOrchestrator.ts`:

```typescript
// The main entry point — ties everything together
export async function predictPlayerProp(input: {
  player: Player
  pitcher: Player
  prop: PropLine
  park: Ballpark
  weather: Weather
  lineupPosition: number
  playerStats: SeasonStats[]
  playerSplits: Splits
  pitcherStats: SeasonStats[]
  pitcherPitchStats: PitchTypeStats[]
}): Promise<PropPrediction> {

  // 1. Marcel regression
  const baseRate = marcelRegressedRate(input.playerStats, LEAGUE_AVG)

  // 2. Log5 matchup
  const matchupRate = log5(baseRate, getPitcherAllowedRate(input.pitcherStats), LEAGUE_AVG)

  // 3. Context adjustments
  let adjustedRate = matchupRate
  adjustedRate = applyParkFactor(adjustedRate, input.park.park_factor_hits)
  adjustedRate = applyWeatherAdjustment(adjustedRate, input.prop.market, input.weather)
  adjustedRate = applyPlatoonAdjustment(adjustedRate, input.player.bats, input.pitcher.throws, input.playerSplits)

  // 4. Expected plate appearances
  const expectedPA = estimatePA(input.lineupPosition)

  // 5. Probability of over via distribution
  let modelProbability: number
  if (input.prop.market === 'hits') {
    modelProbability = binomialProbabilityOver(expectedPA, adjustedRate, input.prop.line_value + 1)
  } else if (input.prop.market === 'home_runs' || input.prop.market === 'strikeouts') {
    modelProbability = poissonProbabilityOver(adjustedRate * expectedPA, input.prop.line_value + 1)
  } else if (input.prop.market === 'total_bases') {
    modelProbability = negativeBinomialProbabilityOver(/* ... */)
  }

  // 6. Edge calculation
  const { edgePct, fairProbability } = calculateEdge(modelProbability, input.prop.fair_odds)

  // 7. Tier classification
  const tier = classifyTier(edgePct)

  // 8. Confidence score
  const confidence = computeConfidence({
    reliability: computeReliability(input.playerStats),
    lineupConfirmed: input.lineupPosition !== null,
    weatherCertainty: 0.9,  // OpenWeather is reliable
    workloadCertainty: getWorkloadCertainty(input.pitcher),
    marketLiquidity: 0.8,
    calibration: 0.85
  })

  // 9. Reasoning generation
  const reasoning = generateReasoning(input, adjustedRate, edgePct)

  // 10. Caveat for high-edge plays
  const caveat = edgePct > 8 ? 'Edge >8% — verify lineup before betting · sharp markets rarely misprice this much' : null

  return {
    player_id: input.player.id,
    prop_market: input.prop.market,
    prop_line: input.prop.line_value,
    model_probability: modelProbability,
    fair_probability: fairProbability,
    edge_pct: edgePct,
    confidence_score: confidence.score,
    confidence_stars: confidence.stars,
    tier,
    reasoning,
    caveat,
    // ... etc
  }
}
```

#### 3.9 Daily Edge Models
Create `/lib/models/dailyEdge/`:

- **scoresModelIngester.ts** — Parses Daniel's uploaded model output
- **sharpSignalEvaluator.ts** — Determines STRONG/CAUTION verdict
- **verdictGenerator.ts** — Composes card banner text

#### 3.10 Tracking Models
Create `/lib/models/tracking/`:

- **outcomeResolver.ts** — Win/loss/push logic
- **aggregator.ts** — Pre-compute time windows
- **calibrationComputer.ts** — Build calibration buckets
- **clvCalculator.ts** — Closing line value (silent for 30 days)

### Phase 3 Acceptance Criteria
- [ ] All distribution functions return correct probabilities (unit tested)
- [ ] Marcel regression matches expected output on Aaron Judge sample data
- [ ] Log5 produces sensible matchup-adjusted rates
- [ ] Context adjustments behave logically (e.g., Coors boosts HR)
- [ ] Edge calculator correctly computes vs SharpAPI fair_odds
- [ ] Tier classifier outputs match thresholds
- [ ] Prop model orchestrator runs end-to-end on mock data
- [ ] Produces realistic predictions on Aaron Judge over 1.5 hits scenario

---

## 📦 PHASE 4: SERVICES + CRON JOBS

### Goal
Wire models to data via service layer, then schedule via cron jobs. Reference `04-cron-jobs.md` for detailed specs of each cron job.

### Tasks

#### 4.1 Service Layer (`/lib/services/`)

**refreshLogger.ts** — MUST BE FIRST (everything depends on it):
```typescript
export const refreshLogger = {
  async start(dataSource: string, sport?: string): Promise<number> { ... },
  async complete(logId: number, result: { success: boolean, records_updated?: number, error_message?: string }): Promise<void> { ... }
}
```

**slateService.ts** — Pull today's games
**statsService.ts** — Refresh player/team stats
**linesService.ts** — Refresh lines + sharp signals from SharpAPI
**lineupService.ts** — Lineup tracking
**weatherService.ts** — Weather forecasts
**predictionService.ts** — Orchestrate model predictions
**resultsService.ts** — Resolve outcomes after games

#### 4.2 Cron Job Routes (`/app/api/cron/`)

Build in order specified in `04-cron-jobs.md`:

1. `daily-refresh/route.ts` (4am)
2. `morning-slate/route.ts` (8am) ⭐ The big one
3. `post-game-results/route.ts` (1am, after games)
4. `midday-refresh/route.ts` (12pm)
5. `afternoon-refresh/route.ts` (3pm)
6. `evening-refresh/route.ts` (5pm)
7. `lineup-watch/route.ts` (every 30min)
8. `pregame-sweep/route.ts` (every 15min final 90 min)
9. `weekly-park-factors/route.ts` (Mondays)
10. `weekly-calibration/route.ts` (Sundays)

Plus manual endpoint:
- `/app/api/manual/upload-scores-model/route.ts` — Daniel's daily upload

#### 4.3 Vercel Cron Configuration
Update `/vercel.json` with all cron schedules (see `04-cron-jobs.md`)

#### 4.4 Authentication
- All cron routes check `Authorization: Bearer ${CRON_SECRET}` header
- Manual routes check admin user (V1: Daniel only)

### Phase 4 Acceptance Criteria
- [ ] All cron routes exist and are accessible
- [ ] CRON_SECRET protects them
- [ ] Manual trigger via curl works for each cron
- [ ] data_refresh_log gets entries for every cron run
- [ ] morning-slate cron successfully:
  - [ ] Pulls 12 mock games
  - [ ] Generates 12 game predictions
  - [ ] Generates ~50 prop predictions
  - [ ] Writes everything to Supabase
- [ ] post-game-results cron successfully resolves outcomes

---

## 📦 PHASE 5: UI WIRING

### Goal
Replace inline mock data in existing components with real data from Supabase. Add new components (RefreshIndicator, HowWeUpdatePanel, CalibrationDisplay).

### Tasks

#### 5.1 Data Hooks (`/app/lab/hooks/`)
- `useDailyEdge.ts` — Today's games + predictions + signals + lineups
- `usePlayerProps.ts` — Prop predictions with filters
- `useTracking.ts` — Tracking aggregates by time window
- `useRefreshStatus.ts` — Latest refresh timestamps
- `useCalibration.ts` — Calibration buckets
- `useSportSelection.ts` — Sport state management

#### 5.2 Update Existing Components
Existing components (LabApp, DailyEdgeView, TonightsBestView, etc.) currently have inline mock data. Replace with:

```typescript
// Before
const games = mockDailyEdgeData  // hardcoded

// After
const { data: games, isLoading } = useDailyEdge()
```

Reference existing files:
- `app/lab/LabApp.tsx`
- `app/lab/components/DailyEdgeView.tsx`
- `app/lab/components/SimpleDailyEdgeCard.tsx`
- `app/lab/components/TonightsBestView.tsx`
- `app/lab/components/SearchFilterView.tsx`
- `app/lab/components/PlayerPropCard.tsx`
- `app/lab/components/TrackingView.tsx`

#### 5.3 New Components To Build

**RefreshIndicator** (`/app/lab/components/RefreshIndicator.tsx`):
- Shows "🟢 Live · Updated 2 minutes ago · Next refresh in 13 min"
- States: Live / Lineup pending / Sharp action / Stale data
- Auto-refreshes via SWR or React Query

**HowWeUpdatePanel** (`/app/lab/components/HowWeUpdatePanel.tsx`):
- Educational panel explaining refresh schedule
- Builds member trust + transparency
- Collapsible or modal

**CalibrationDisplay** (`/app/lab/components/tracking/CalibrationDisplay.tsx`):
- Shows confidence bucket table
- "When we say 60% confidence, we hit 58% of the time"
- Only display buckets with `is_displayable = true` (30+ samples)

### Phase 5 Acceptance Criteria
- [ ] All UI pages load data from Supabase (no inline mocks remaining)
- [ ] Sport selector works across all pages
- [ ] Daily Edge cards render with real predictions + signals + lineups
- [ ] Player Props Tonight's Best mode shows tier-based filtering
- [ ] Player Props Search & Filter mode supports all filters
- [ ] Tracking page shows all time windows with honest bars
- [ ] RefreshIndicator updates correctly
- [ ] HowWeUpdatePanel displays correctly
- [ ] CalibrationDisplay shows when enough samples exist

---

## 📦 PHASE 6: POLISH + QA

### Goal
Make the product feel professional. Cover all edge cases. Test extensively.

### Tasks

#### 6.1 UI States
For every section, add:
- **Loading state** — Skeleton or spinner
- **Empty state** — "No predictions for today" with helpful message
- **Error state** — Friendly error + retry button
- **Coming soon state** — For inactive sports

#### 6.2 End-to-End Test Pass
Manual QA checklist:
- [ ] Visit `/lab` — page loads
- [ ] Daily Edge shows 12 mock games with verdicts
- [ ] Click "Show signal breakdown" — expanded view works
- [ ] Player Props "Tonight's Best" shows tiered props
- [ ] Switch to "Search & Filter" — table view works
- [ ] Apply filters — results update
- [ ] Click "Tonight's Strongest" preset — filters apply
- [ ] Switch sports — coming soon states display
- [ ] Tracking page shows all 4 time sections
- [ ] Bars are honest (50% = 50% wide)
- [ ] Calibration displays when toggled (if buckets exist)
- [ ] RefreshIndicator updates every minute
- [ ] HowWeUpdatePanel opens and closes
- [ ] No console errors

#### 6.3 Performance
- [ ] Lighthouse score >90 on Performance
- [ ] Page loads in <2 seconds on Vercel
- [ ] Supabase queries optimized (use indexes)
- [ ] React Query caching configured

#### 6.4 Mobile Responsiveness
- [ ] All views work on 375px width
- [ ] Filters collapse properly on mobile
- [ ] Tables scroll horizontally on small screens

### Phase 6 Acceptance Criteria
- [ ] All UI states implemented
- [ ] Manual QA passes
- [ ] Performance metrics meet targets
- [ ] Mobile UX is polished

---

## 📦 PHASE 7: TRIAL VERIFICATION

### Goal
Verify real APIs return data in expected shapes. Catch any mismatches before paying.

### Tasks

#### 7.1 Sign Up For Free Trials
Daniel signs up for:
- [ ] BALLDONTLIE free tier (no card needed)
- [ ] SharpAPI free tier (12 req/min)
- [ ] OpenWeather free tier (already free)

Daniel adds keys to `.env.local`:
```bash
BALLDONTLIE_API_KEY=<free_tier_key>
SHARPAPI_KEY=<free_tier_key>
OPENWEATHER_API_KEY=<free_tier_key>
```

#### 7.2 Implement Real Providers

**BallDontLieProvider** (`/lib/providers/real/BallDontLieProvider.ts`):
- Implements IStatsProvider
- Calls `https://api.balldontlie.io/mlb/v1/...`
- Handles rate limiting with retry logic

**SharpAPIProvider** (`/lib/providers/real/SharpAPIProvider.ts`):
- Implements IBettingProvider
- Calls `https://api.sharpapi.io/api/v1/...`
- Maps SharpAPI shape to internal types

**OpenWeatherProvider** (`/lib/providers/real/OpenWeatherProvider.ts`):
- Implements IWeatherProvider
- Calls OpenWeather API

**FanGraphsProvider** (`/lib/providers/real/FanGraphsProvider.ts`):
- Scrapes FanGraphs park factors page
- Parses HTML, extracts data

#### 7.3 Take Premium Trials
- [ ] BALLDONTLIE GOAT 48-hour trial
- [ ] SharpAPI Pro 3-day trial

#### 7.4 Flip Provider Switches
One provider at a time, verify each works:
```bash
USE_REAL_STATS=true   # Test BALLDONTLIE
# ... run morning-slate cron, verify data flows
```

Then:
```bash
USE_REAL_BETTING=true # Test SharpAPI
# ... run morning-slate cron, verify props flow
```

#### 7.5 Verify Mock vs Real Match
For each provider:
- [ ] Mock shape matches real API response
- [ ] No code changes needed when switching
- [ ] Cron jobs run successfully with real data
- [ ] Predictions look reasonable

#### 7.6 Backtest Props Model
- [ ] Pull 30 days of historical games + props
- [ ] Run model against historical data
- [ ] Compare predictions to actual outcomes
- [ ] Measure: Hit rate by tier, CLV, calibration

### Phase 7 Acceptance Criteria
- [ ] All 4 real providers implemented
- [ ] All free tiers verified to return expected data
- [ ] No code changes needed to flip USE_REAL_* flags
- [ ] Mock shapes verified to match real API shapes
- [ ] Backtest shows props model is reasonable (>52% hit rate at PREMIUM tier minimum)

---

## 📦 PHASE 8: LAUNCH PREP

### Tasks

#### 8.1 Whop Integration
- [ ] Whop OAuth setup
- [ ] Membership gating on /lab route
- [ ] Webhook for new members
- [ ] Charter member detection

#### 8.2 Subscribe To Paid Tiers
- [ ] BALLDONTLIE GOAT MLB ($39.99/mo)
- [ ] SharpAPI Pro ($229/mo or whatever pricing applies)
- [ ] Supabase Pro ($25/mo)
- [ ] Vercel Pro ($20/mo)

#### 8.3 Production Environment Variables
In Vercel dashboard, set:
- All `USE_REAL_*=true`
- All API keys (production keys)
- CRON_SECRET (production token)
- WHOP_API_KEY, WHOP_WEBHOOK_SECRET

#### 8.4 Final QA
- [ ] Production build works
- [ ] All cron jobs verified in production
- [ ] Member can sign in and access lab
- [ ] Non-members are blocked
- [ ] Data flows through real APIs
- [ ] Models produce sensible predictions
- [ ] Tracking page shows real numbers

### Phase 8 Acceptance Criteria
- [ ] Production environment fully configured
- [ ] All subscriptions active
- [ ] Whop auth works
- [ ] Real data flowing through all crons
- [ ] No errors in production logs

---

## 📦 PHASE 9: LAUNCH 🚀

### Tasks

#### 9.1 Deploy Lab To Production
- [ ] Remove noindex from /lab route
- [ ] Add Lab nav link to main marketing site
- [ ] Test all paths from public site → Lab

#### 9.2 Charter Member Announcement
Daniel sends Discord announcement:
- [ ] Drop link to /lab
- [ ] Welcome charter members
- [ ] Set expectations (V1 features, more coming)

#### 9.3 Monitor First Week
- [ ] Watch data_refresh_log for cron failures
- [ ] Monitor API rate limits
- [ ] Watch user feedback
- [ ] Watch tracking accuracy

### Phase 9 Acceptance Criteria
- [ ] Lab is publicly accessible (members only)
- [ ] First 20 charter members onboarded
- [ ] No critical bugs in week 1
- [ ] Founder + members happy with product

---

## 📚 REFERENCE DOCUMENTS

These supporting documents provide detailed specifications:

1. **`00-FOUNDATION.md`** (609 lines) — Master decision log, brand voice, banned features
2. **`01-database-schema.md`** (937 lines) — Complete SQL schema for all 23 tables
3. **`02-mock-data-shapes.md`** (954 lines) — Real API shapes, mock data design
4. **`03-build-architecture.md`** (593 lines) — File structure, provider pattern, build order
5. **`04-cron-jobs.md`** (727 lines) — Detailed cron job specifications

**Total planning documentation: 3,820 lines + this spec doc = ~4,500 lines**

---

## 🎯 KEY SUCCESS METRICS

### Build Phase Success
- [ ] All 23 tables created
- [ ] All providers implemented (mock + real)
- [ ] Models produce mathematically sound predictions
- [ ] UI renders correctly with all data states
- [ ] Cron jobs run reliably
- [ ] Mock-to-real switch is zero-code-change

### Launch Phase Success
- [ ] First week: 0 cron failures
- [ ] First week: All 20 charter members onboarded
- [ ] First month: 60%+ prop predictions at STRONG/PREMIUM tier hit
- [ ] First month: Honest tracking shows real numbers (good days + bad)
- [ ] Charter retention > 90% (no one cancels first month)

### Long-term Success
- [ ] Month 3: 30+ paying members (charter + new)
- [ ] Month 3: Positive CLV trend (decide on display)
- [ ] Month 6: Add NBA props
- [ ] Month 12: Add NFL props for season

---

## 🚨 CRITICAL REMINDERS FOR CLAUDE CODE

### Before You Start Each Task
1. ✅ Read the relevant supporting doc section
2. ✅ Check FOUNDATION.md for any related decisions
3. ✅ Verify acceptance criteria for the phase
4. ✅ Don't deviate without explicit approval from Daniel

### When In Doubt
1. ✅ Default to honest tracking + brand integrity
2. ✅ Default to math-based reasoning over vibes
3. ✅ Default to less features done well
4. ✅ Ask Daniel rather than assuming
5. ✅ Refer to documented decisions

### Things To Always Do
- ✅ Write TypeScript strict mode
- ✅ Add JSDoc to public functions
- ✅ Handle errors on async operations
- ✅ Log to data_refresh_log on cron runs
- ✅ Use provider abstraction (never call APIs from UI)

### Things To Never Do
- ❌ Hardcode prediction values
- ❌ Use banned language (LOCK, FADE, hot streak)
- ❌ Show worst-day callouts
- ❌ Use stars on player prop cards
- ❌ Inflate edge percentages
- ❌ Show sport-level aggregate totals
- ❌ Skip mock-first approach

---

## 🎉 YOU'RE READY TO BUILD

When you start, work through the phases in order. Each phase has clear acceptance criteria.

**Estimated total build time: 5-9 weeks**
- Phases 1-6 (Build with mocks): 4-6 weeks
- Phase 7 (Trial verification): 1 week
- Phase 8 (Launch prep): 1-2 weeks
- Phase 9 (Launch): 1 week

When uncertain about any decision, refer back to the planning documents. They are the source of truth.

**Let's build something great. 🚀**
