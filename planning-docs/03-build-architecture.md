# Oddsphere Lab — Build Architecture

**Status:** Day 5 design session
**Purpose:** Define the codebase structure, abstractions, and data flow for the Lab
**Build Order:** This document tells Claude Code WHERE every file goes and HOW they connect

---

## Core Architecture Principles

### 1. Provider Abstraction Pattern
The system never knows if it's talking to a mock or real API. Environment variable controls which provider is active.

```
Cron Jobs → Service Layer → Provider Layer → Data Source
                              ↓
                    ┌─────────┴──────────┐
                    │                    │
              MockProvider         RealProvider
              (used during         (used at launch)
                build)
```

**Why:** Mock-first build approach. Flip one env var to switch to real APIs.

### 2. Separation Of Concerns

| Layer | Responsibility |
|-------|----------------|
| **UI Components** | Render data, handle interactions |
| **Hooks/Services** | Fetch and format data from Supabase |
| **API Routes** | Server-side endpoints (cron jobs, webhooks) |
| **Service Layer** | Business logic (model calculations) |
| **Provider Layer** | Data source abstraction (mock vs real) |
| **Database (Supabase)** | Source of truth for all data |

### 3. Single Source Of Truth: Supabase
- ✅ All UI reads from Supabase
- ✅ All cron jobs write to Supabase
- ✅ Model writes predictions to Supabase
- ✅ UI never calls external APIs directly

**Why:** Decoupling. UI doesn't care where data came from.

---

## 📁 Complete File Structure

```
/oddsphere
├── app/
│   ├── lab/                                # The Lab (hidden route)
│   │   ├── page.tsx                        # Entry point, noindex
│   │   ├── LabApp.tsx                      # Main app shell, section routing
│   │   ├── layout.tsx                      # Lab-specific layout (if needed)
│   │   │
│   │   ├── components/                     # UI components
│   │   │   ├── Icon.tsx                    # Reusable icon component
│   │   │   ├── LabNav.tsx                  # Top nav (Daily Edge / Player Props / Tracking / My Bets)
│   │   │   ├── LabHeader.tsx               # Lab title + sport selector
│   │   │   ├── SportSelector.tsx           # 7-sport picker with coming-soon states
│   │   │   ├── RefreshIndicator.tsx        # "Updated 3 min ago" component
│   │   │   ├── HowWeUpdatePanel.tsx        # Educational panel about cadence
│   │   │   │
│   │   │   ├── daily-edge/
│   │   │   │   ├── DailyEdgeView.tsx       # Main DE view
│   │   │   │   ├── DailyEdgeCard.tsx       # Single game card
│   │   │   │   ├── DailyEdgeBreakdown.tsx  # Expanded breakdown
│   │   │   │   ├── SharpSignalBanner.tsx   # STRONG/CAUTION banner
│   │   │   │   ├── LineMovementWidget.tsx  # Open → current display
│   │   │   │   ├── PitcherInfo.tsx         # Pitcher one-liner
│   │   │   │   ├── WeatherInfo.tsx         # Conditional weather
│   │   │   │   ├── LineupUpdate.tsx        # Conditional scratch alerts
│   │   │   │   └── ProjectedScore.tsx      # HERO stat (44px)
│   │   │   │
│   │   │   ├── player-props/
│   │   │   │   ├── PlayerPropsView.tsx     # Main props view (mode toggle)
│   │   │   │   ├── ModeToggle.tsx          # Tonight's Best / Search & Filter
│   │   │   │   ├── PropMarketTabs.tsx      # Hits/HR/TB/K/ER tabs
│   │   │   │   ├── tonights-best/
│   │   │   │   │   ├── TonightsBestView.tsx
│   │   │   │   │   ├── PlayerPropCard.tsx  # Compact scannable card
│   │   │   │   │   ├── TierBadge.tsx       # PREMIUM/STRONG/GOOD badge
│   │   │   │   │   └── PropSummaryBar.tsx  # "9 picks · 1 prem · 5 strong..."
│   │   │   │   ├── search-filter/
│   │   │   │   │   ├── SearchFilterView.tsx
│   │   │   │   │   ├── FilterGroup.tsx     # THE MODEL/PLAYER/MATCHUP/CONDITIONS
│   │   │   │   │   ├── QuickPresets.tsx    # Tonight's Strongest, etc.
│   │   │   │   │   ├── PropsTable.tsx      # Filtered results table
│   │   │   │   │   └── PropsTableRow.tsx
│   │   │   │   └── PlayerPropDrillDown.tsx # Full breakdown when "Show breakdown" clicked
│   │   │   │
│   │   │   ├── tracking/
│   │   │   │   ├── TrackingView.tsx        # Main tracking view
│   │   │   │   ├── TimeSection.tsx         # Yesterday / Week / Season / All-Time
│   │   │   │   ├── SportCard.tsx           # Per-sport card
│   │   │   │   ├── MarketRow.tsx           # ML / NRFI / YRFI / O/U row
│   │   │   │   ├── HonestBar.tsx           # True % bar with color coding
│   │   │   │   ├── CalibrationDisplay.tsx  # NEW: Calibration credibility
│   │   │   │   └── TrackingFooter.tsx      # Methodology note
│   │   │   │
│   │   │   ├── my-bets/
│   │   │   │   └── MyBetsView.tsx          # User-pinned bets (V1.5)
│   │   │   │
│   │   │   └── shared/
│   │   │       ├── LoadingState.tsx
│   │   │       ├── EmptyState.tsx
│   │   │       ├── ErrorState.tsx
│   │   │       └── ComingSoonState.tsx
│   │   │
│   │   ├── hooks/                          # Data fetching hooks
│   │   │   ├── useDailyEdge.ts             # Fetches DE predictions for today
│   │   │   ├── usePlayerProps.ts           # Fetches prop predictions
│   │   │   ├── useTracking.ts              # Fetches tracking data
│   │   │   ├── useRefreshStatus.ts         # Fetches refresh timestamps
│   │   │   ├── useCalibration.ts           # Fetches calibration data
│   │   │   └── useSportSelection.ts        # State management for sport
│   │   │
│   │   └── lib-shim.ts                     # Supabase client re-export
│   │
│   ├── api/                                # Server-side API routes
│   │   ├── cron/                           # Cron job endpoints
│   │   │   ├── daily-refresh/route.ts      # 4am: stats, park factors
│   │   │   ├── morning-slate/route.ts      # 8am: today's games, opening lines
│   │   │   ├── midday-refresh/route.ts     # 12pm: lines, sharp signals
│   │   │   ├── afternoon-refresh/route.ts  # 3pm: lines, weather
│   │   │   ├── evening-refresh/route.ts    # 5pm: lines, lineup watch starts
│   │   │   ├── lineup-watch/route.ts       # Every 30min: lineups
│   │   │   ├── pregame-sweep/route.ts      # Every 15min final hour
│   │   │   ├── post-game-results/route.ts  # After games: tracking + CLV
│   │   │   └── weekly-calibration/route.ts # Sunday: recompute calibration
│   │   │
│   │   ├── manual/                         # Manual triggers (admin)
│   │   │   └── upload-scores-model/route.ts # Daniel uploads his model output
│   │   │
│   │   └── webhooks/
│   │       └── whop/route.ts               # Whop membership webhooks (V1.5)
│   │
│   └── (existing marketing site files...)
│
├── lib/                                    # Shared business logic
│   ├── providers/                          # Data provider layer (CRITICAL)
│   │   ├── interfaces/
│   │   │   ├── IStatsProvider.ts           # BALLDONTLIE contract
│   │   │   ├── IBettingProvider.ts         # SharpAPI contract
│   │   │   ├── IWeatherProvider.ts         # OpenWeather contract
│   │   │   └── IParkFactorProvider.ts      # FanGraphs contract
│   │   │
│   │   ├── mock/                           # Mock implementations (used during build)
│   │   │   ├── MockStatsProvider.ts
│   │   │   ├── MockBettingProvider.ts
│   │   │   ├── MockWeatherProvider.ts
│   │   │   ├── MockParkFactorProvider.ts
│   │   │   └── mock-data/                  # JSON files (matched real API shapes)
│   │   │       ├── teams.json
│   │   │       ├── players.json
│   │   │       ├── games.json
│   │   │       ├── ... (all mock files from 02-mock-data-shapes.md)
│   │   │
│   │   ├── real/                           # Real implementations (used at launch)
│   │   │   ├── BallDontLieProvider.ts      # Implements IStatsProvider
│   │   │   ├── SharpAPIProvider.ts         # Implements IBettingProvider
│   │   │   ├── OpenWeatherProvider.ts      # Implements IWeatherProvider
│   │   │   └── FanGraphsProvider.ts        # Implements IParkFactorProvider
│   │   │
│   │   └── factory.ts                      # Returns mock or real based on env var
│   │
│   ├── models/                             # Statistical models
│   │   ├── props/
│   │   │   ├── marcelRegression.ts         # 3-yr weighted regression
│   │   │   ├── log5Matchup.ts              # Bill James batter-vs-pitcher
│   │   │   ├── contextAdjustments.ts       # Park, weather, platoon
│   │   │   ├── distributions/
│   │   │   │   ├── binomial.ts             # For hits
│   │   │   │   ├── poisson.ts              # For HR/K/ER/HA
│   │   │   │   └── negativeBinomial.ts     # For TB
│   │   │   ├── confidenceScore.ts          # 6-factor confidence
│   │   │   ├── edgeCalculator.ts           # Compare model vs market
│   │   │   ├── tierClassifier.ts           # PREMIUM/STRONG/GOOD
│   │   │   └── propModelOrchestrator.ts    # Ties it all together
│   │   │
│   │   ├── dailyEdge/
│   │   │   ├── scoresModelIngester.ts      # Imports Daniel's model output
│   │   │   ├── sharpSignalEvaluator.ts     # Determines STRONG/CAUTION
│   │   │   └── verdictGenerator.ts         # Composes the card banner
│   │   │
│   │   └── tracking/
│   │       ├── outcomeResolver.ts          # Win/loss/push logic
│   │       ├── aggregator.ts               # Pre-compute time windows
│   │       ├── calibrationComputer.ts      # Build calibration buckets
│   │       └── clvCalculator.ts            # Compute closing line value
│   │
│   ├── services/                           # Orchestration layer
│   │   ├── slateService.ts                 # Pull today's games
│   │   ├── statsService.ts                 # Refresh player/team stats
│   │   ├── linesService.ts                 # Refresh lines + sharp signals
│   │   ├── lineupService.ts                # Lineup tracking
│   │   ├── weatherService.ts               # Weather forecasts
│   │   ├── predictionService.ts            # Run models, write predictions
│   │   ├── refreshLogger.ts                # Track all refreshes
│   │   └── resultsService.ts               # Resolve outcomes after games
│   │
│   ├── db/                                 # Database utilities
│   │   ├── supabase.ts                     # Server-side Supabase client
│   │   ├── supabaseBrowser.ts              # Client-side Supabase client
│   │   ├── queries/                        # Reusable query functions
│   │   │   ├── games.ts
│   │   │   ├── players.ts
│   │   │   ├── predictions.ts
│   │   │   └── tracking.ts
│   │   └── schema.sql                      # Full schema for migrations
│   │
│   ├── types/                              # TypeScript types
│   │   ├── api/                            # API response types
│   │   │   ├── balldontlie.ts
│   │   │   ├── sharpapi.ts
│   │   │   ├── openweather.ts
│   │   │   └── fangraphs.ts
│   │   ├── domain/                         # Internal domain types
│   │   │   ├── Player.ts
│   │   │   ├── Game.ts
│   │   │   ├── Prediction.ts
│   │   │   └── Tracking.ts
│   │   └── ui/                             # UI-specific types
│   │       ├── DailyEdgeCardProps.ts
│   │       ├── PlayerPropCardProps.ts
│   │       └── TrackingCardProps.ts
│   │
│   ├── config/                             # Configuration
│   │   ├── env.ts                          # Environment variables (typed)
│   │   ├── constants.ts                    # App constants (edge thresholds, etc.)
│   │   ├── sportConfigs.ts                 # Per-sport config (MLB markets, etc.)
│   │   └── refreshSchedule.ts              # Cron schedule definitions
│   │
│   └── utils/                              # Pure utility functions
│       ├── odds.ts                         # American↔Decimal↔Implied conversions
│       ├── dates.ts                        # Date formatting, timezones
│       ├── stats.ts                        # Statistical helpers
│       └── format.ts                       # Display formatting (W-L, %, etc.)
│
├── public/                                 # Static assets
│   └── (logos, images, etc.)
│
├── .env.local                              # Environment variables (gitignored)
├── .env.example                            # Template for env vars
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

---

## 🔌 Provider Abstraction Detail

### The Factory Pattern

```typescript
// lib/providers/factory.ts
import { IStatsProvider, IBettingProvider } from './interfaces'
import { MockStatsProvider, MockBettingProvider } from './mock'
import { BallDontLieProvider, SharpAPIProvider } from './real'

export function getStatsProvider(): IStatsProvider {
  if (process.env.USE_REAL_STATS === 'true') {
    return new BallDontLieProvider({
      apiKey: process.env.BALLDONTLIE_API_KEY!
    })
  }
  return new MockStatsProvider()
}

export function getBettingProvider(): IBettingProvider {
  if (process.env.USE_REAL_BETTING === 'true') {
    return new SharpAPIProvider({
      apiKey: process.env.SHARPAPI_KEY!
    })
  }
  return new MockBettingProvider()
}
```

### Interface Example: IStatsProvider

```typescript
// lib/providers/interfaces/IStatsProvider.ts
export interface IStatsProvider {
  // Teams & Players
  getTeams(sport: string): Promise<Team[]>
  getPlayers(teamId: number): Promise<Player[]>
  getPlayer(playerId: number): Promise<Player | null>

  // Stats
  getPlayerSeasonStats(playerId: number, seasons: number[]): Promise<SeasonStats[]>
  getPlayerSplits(playerId: number, season: number): Promise<Splits>
  getPitcherPitchStats(pitcherId: number, season: number): Promise<PitchTypeStats[]>

  // Game day
  getGames(date: string): Promise<Game[]>
  getLineups(gameId: number): Promise<Lineup[]>
  getInjuries(): Promise<Injury[]>
}
```

### Why This Pattern Works

1. **Build phase:** All cron jobs call `getStatsProvider().getPlayers(...)` → MockStatsProvider returns from JSON files
2. **Verification phase:** Set `USE_REAL_STATS=true` → SAME code now calls BALLDONTLIE → mock data → real data swap
3. **Launch phase:** Production environment has all real env vars set → fully live

**Zero code changes between phases.** Just environment variables.

---

## 🔄 Data Flow Diagrams

### Daily Refresh Flow (4am Cron)

```
Cron Trigger (4am ET)
    ↓
GET /api/cron/daily-refresh
    ↓
RefreshLogger.start('daily_stats_refresh')
    ↓
statsService.refreshAllStats()
    ↓
    ├→ getStatsProvider().getPlayers(...)  ─→ MockStatsProvider OR BallDontLieProvider
    ├→ getStatsProvider().getPlayerSeasonStats(...)
    └→ getStatsProvider().getPlayerSplits(...)
    ↓
Write to Supabase tables (players, player_season_stats, player_splits)
    ↓
RefreshLogger.complete('daily_stats_refresh', success: true)
```

### Player Props Prediction Flow

```
Cron Trigger (8am: morning-slate, then 12pm/3pm/5pm refreshes)
    ↓
GET /api/cron/morning-slate (or others)
    ↓
For each game tonight:
    ↓
    ├→ getStatsProvider().getLineups(gameId)
    ├→ getStatsProvider().getInjuries() (filter for this game's players)
    ├→ getBettingProvider().getPlayerProps(gameId)  ← Includes ev_percent, fair_odds!
    ├→ getWeatherProvider().getForecast(...)
    └→ DB query: player career stats from Supabase
    ↓
For each prop line (Judge O 1.5 hits, Cole O 7.5 K, etc.):
    ↓
    propModelOrchestrator.predict({
      player,
      pitcher,
      prop,
      park,
      weather,
      lineup_position
    })
    ↓
    ├→ marcelRegression → base rate
    ├→ log5Matchup → matchup-adjusted rate
    ├→ contextAdjustments → park/weather/platoon
    ├→ distributions → probability of over
    ├→ edgeCalculator → compare to SharpAPI fair_odds
    ├→ confidenceScore → 6-factor calc
    └→ tierClassifier → PREMIUM/STRONG/GOOD
    ↓
Write to prop_predictions table
    ↓
RefreshLogger.complete()
```

### UI Render Flow

```
User visits /lab
    ↓
LabApp.tsx loads
    ↓
useDailyEdge() hook fires
    ↓
DB Query: SELECT * FROM game_predictions WHERE game_date = today
    ↓
DB Query: SELECT * FROM sharp_signals WHERE game_id IN (...)
    ↓
DB Query: SELECT * FROM lineups WHERE game_id IN (...)
    ↓
Combine into DailyEdgeCardProps[]
    ↓
Render DailyEdgeCard components
    ↓
useRefreshStatus() hook fires
    ↓
DB Query: latest entry per data_source from data_refresh_log
    ↓
Render RefreshIndicator ("Updated 3 min ago")
```

**Critical:** UI never calls external APIs directly. All data flows through Supabase.

---

## 🔐 Environment Variables

```bash
# .env.local

# Supabase (always real)
NEXT_PUBLIC_SUPABASE_URL=https://jounoyrkcirgmyjccxll.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Provider Switches (mock vs real)
USE_REAL_STATS=false        # BALLDONTLIE
USE_REAL_BETTING=false      # SharpAPI
USE_REAL_WEATHER=false      # OpenWeather
USE_REAL_PARK_FACTORS=false # FanGraphs

# API Keys (only used when corresponding flag is true)
BALLDONTLIE_API_KEY=        # Filled after free trial
SHARPAPI_KEY=               # Filled after free trial
OPENWEATHER_API_KEY=        # Free, can fill anytime

# Cron Authentication
CRON_SECRET=                # Bearer token for cron route protection

# Whop (V1.5)
WHOP_API_KEY=
WHOP_WEBHOOK_SECRET=
```

### Phase Transitions Via Env Vars

| Phase | USE_REAL_STATS | USE_REAL_BETTING | USE_REAL_WEATHER |
|-------|----------------|-------------------|------------------|
| Build | false | false | false |
| Trial verification | true | true | true |
| Launch | true | true | true |

---

## 📦 Build Order For Claude Code

This is the recommended order Claude Code should build things:

### Phase 1: Foundation (Week 1)
1. ✅ Database schema migration (from 01-database-schema.md)
2. ✅ TypeScript types (`/lib/types/`)
3. ✅ Supabase client setup (`/lib/db/supabase.ts`)
4. ✅ Environment variable handling (`/lib/config/env.ts`)
5. ✅ Provider interfaces (`/lib/providers/interfaces/`)

### Phase 2: Mock Providers + Data (Week 1-2)
6. ✅ Generate all mock JSON files (from 02-mock-data-shapes.md)
7. ✅ Implement `MockStatsProvider`
8. ✅ Implement `MockBettingProvider`
9. ✅ Implement `MockWeatherProvider`
10. ✅ Implement `MockParkFactorProvider`
11. ✅ Provider factory (`/lib/providers/factory.ts`)

### Phase 3: Models (Week 2-3)
12. ✅ Statistical utilities (Binomial, Poisson, Neg Binomial)
13. ✅ Marcel regression implementation
14. ✅ Log5 matchup math
15. ✅ Context adjustments (park/weather/platoon)
16. ✅ Edge calculator
17. ✅ Tier classifier
18. ✅ Confidence score (6-factor)
19. ✅ Prop model orchestrator

### Phase 4: Services + Cron Jobs (Week 3-4)
20. ✅ Slate service (pull games)
21. ✅ Stats service (refresh stats)
22. ✅ Lines service (refresh lines)
23. ✅ Lineup service
24. ✅ Weather service
25. ✅ Prediction service (orchestrate model)
26. ✅ Refresh logger
27. ✅ Results service (post-game)
28. ✅ All 9 cron route handlers

### Phase 5: UI Wiring (Week 4-5)
29. ✅ Data hooks (`useDailyEdge`, `usePlayerProps`, `useTracking`)
30. ✅ Wire existing components to real data (replacing inline mock data)
31. ✅ Add `RefreshIndicator` component
32. ✅ Add `HowWeUpdatePanel` component
33. ✅ Add `CalibrationDisplay` component

### Phase 6: Polish + QA (Week 5-6)
34. ✅ Loading states
35. ✅ Empty states
36. ✅ Error states
37. ✅ End-to-end test passes
38. ✅ All UI states verified with mock data
39. ✅ Performance optimization (queries, caching)

### Phase 7: Trial Verification (Week 6-7)
40. ✅ Sign up for free trials (BALLDONTLIE, SharpAPI)
41. ✅ Flip USE_REAL_STATS=true
42. ✅ Run cron jobs, verify real data flows through
43. ✅ Compare real outputs to mock outputs (should match shape)
44. ✅ Flip USE_REAL_BETTING=true
45. ✅ Full system test with real data

### Phase 8: Launch Prep (Week 7-8)
46. ✅ Whop auth integration
47. ✅ Membership gating
48. ✅ Backtest props model on historical data
49. ✅ Calibration validation
50. ✅ Subscribe to paid tiers
51. ✅ Final production QA

### Phase 9: LAUNCH 🚀
52. ✅ Deploy to production
53. ✅ Announce to charter members
54. ✅ Monitor + iterate

---

## 🎯 Critical Design Decisions

### Why Server-Side Cron Jobs (Not Client-Side)
- ✅ Cron jobs need API keys (can't expose to client)
- ✅ Vercel Cron is built-in (no extra infrastructure)
- ✅ Routes can be protected with CRON_SECRET bearer token

### Why Polling Not Real-Time (Initially)
- ✅ Sub-second updates not needed for our use case
- ✅ Simpler architecture
- ✅ Lower infrastructure cost
- ✅ Can add Supabase Realtime later if needed

### Why Pre-Computed Predictions
- ✅ UI loads instantly (no model runs on render)
- ✅ Model runs are expensive (we run them on cron schedule)
- ✅ Cached results easy to invalidate when lines change

### Why TypeScript Strict Mode
- ✅ Catch errors at compile time
- ✅ Better Claude Code experience (clearer intent)
- ✅ Refactoring confidence

---

## 🚨 Things To Watch For

### Data Volume At Scale
- 90 days × ~50 predictions/day = 4,500 predictions
- 23 tables × growing rows = ~50K rows after 6 months
- **Supabase free tier (500MB) handles this easily**
- Pro tier needed at scale (~50K active members? not soon)

### API Rate Limits
- BALLDONTLIE GOAT: 600 req/min — generous
- SharpAPI Pro: TBD at trial — built-in caching helps
- OpenWeather Free: 60/min, 1M/month — fine for 12 games/day
- **Rate limit alerts via `data_refresh_log` table tracking**

### Mock Data Maintenance
- Mock data is committed to git
- Lives in `/lib/providers/mock/mock-data/`
- Update mock data when API shapes change
- Mock data should match latest API responses

---

## 📊 Code Quality Standards

### Required For All Files
1. ✅ TypeScript strict mode
2. ✅ Explicit return types on functions
3. ✅ JSDoc comments on public functions
4. ✅ Error handling on all async operations
5. ✅ No `any` types (use `unknown` if truly unknown)

### Testing Approach
1. ✅ Unit tests for math (`/lib/models/`)
2. ✅ Integration tests for providers
3. ✅ E2E tests for critical user flows
4. ✅ Snapshot tests for UI components

---

## Next Steps After Architecture

1. ✅ Build architecture documented (THIS FILE)
2. 🟡 Cron job detailed specs (next session)
3. 🟡 Final spec document for Claude Code (ties everything together)

**Two more planning sessions, then Claude Code execution begins.**
