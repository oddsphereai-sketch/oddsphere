# Oddsphere AI Lab — Planning Foundation Document

**Purpose:** Single source of truth for ALL planning decisions made for the Oddsphere AI Lab build.
**Owner:** Daniel Mengel (@OddSphereAI)
**Last Updated:** Day 5 evening — 🎉 PLANNING PHASE COMPLETE 🎉
**Status:** ✅ All planning docs created. Ready for Claude Code handoff.

---

## 🎉 PLANNING PHASE COMPLETE

5 master planning documents, 4,500+ lines total:

| # | Doc | Lines | Status |
|---|-----|-------|--------|
| 00 | FOUNDATION | 600+ | ✅ Master decision log |
| 01 | database-schema | 937 | ✅ 23 tables LOCKED |
| 02 | mock-data-shapes | 954 | ✅ API shapes verified |
| 03 | build-architecture | 593 | ✅ File structure complete |
| 04 | cron-jobs | 727 | ✅ All 11 crons specified |
| 05 | claude-code-spec | ~720 | ✅ Master handoff doc |

**Next step:** Hand off to Claude Code for execution. See `05-claude-code-spec.md`.

---

**Read this FIRST at the start of every planning session — it ensures nothing is lost.**

---

## DAY 5 UPDATES (NEW)

### Data Update Cadence — LOCKED
- 🟢 **4am ET (Daily):** Player season stats, park factors weekly
- 🟢 **8am ET (Daily):** Today's slate pull, opening lines, initial Daily Edge + Props compute
- 🟢 **12pm ET:** Mid-morning line refresh, sharp signals refresh
- 🟢 **3pm ET:** Line refresh, sharp signals, weather forecast update
- 🟢 **5pm ET:** Line refresh, weather refresh, START lineup watch
- 🟢 **5pm-game time (every 30min):** Lineup drops, scratch detection, re-compute props when confirmed
- 🟢 **Final 90 min before each game (every 15min):** Final sharp action, last-minute injuries, steam alerts

### New V1 Features Added — LOCKED
- ✅ **Calibration Display** on Tracking page (credibility win)
- ✅ **"How We Update" educational panel** (trust win + your suggestion)
- ✅ **CLV Tracking** — silent for 30 days, then evaluate display

### "Time Updated" Indicators — LOCKED
- Site-wide status bar at top of Lab
- Per-section indicators (Daily Edge / Player Props / Tracking)
- Special states: 🟢 Live / 🟡 Lineup pending / 🟠 Sharp action / 🔴 Stale data

### Discord Teaser — SENT (Day 5)
- Casual voice, dumbed down for everyone
- Focused on benefits for users, not technical methodology
- Took out unverified Blue Jays ML claim (Daniel's honesty)
- Held Tracking page reveal for formal announcement (strategic anticipation)

---

## TABLE OF CONTENTS

1. Founder Profile & Context
2. Business Model & Economics
3. Tech Stack — LOCKED
4. Product Vision — LOCKED
5. UI Design Decisions — LOCKED
6. Brand Voice Decisions — LOCKED
7. Player Props Methodology — LOCKED
8. Launch Sequence — LOCKED
9. Data Provider Strategy — LOCKED
10. UI Polish — LOCKED
11. Database Schema — DRAFT V2 (separate document, refined Day 5)
12. Open Decisions & Next Steps
13. What NOT To Do (Things We Explicitly Rejected)
14. Reference Material

---

## 1. FOUNDER PROFILE & CONTEXT

**Daniel Mengel** (@OddSphereAI)
- X followers: 2.1K
- Current paying members: 20 (mix of $25/mo charter + $35/mo standard)
- Location: St. Petersburg, FL
- Background: Complete coding beginner
- Existing product: AI sports predictions across 7 leagues (MLB, NBA, NFL, NHL, CBB, CFB, UCL)
- Tracked predictions to date: 25K+
- Marketing site: LIVE at oddsphere-ruby.vercel.app (NOT Google-indexed, shareable by link)
- Lab route: Hidden at /lab (also not indexed)
- Whop URL: whop.com/oddsphereai

### Daniel's Founder Strengths (Demonstrated)
- Pushed back on bad pricing assumptions (saved $200+/mo)
- Caught SharpAPI/Odds API overlap (saved $30/mo)
- Rejected hot streaks, lock language, worst-day callouts (brand integrity)
- Caught designing components in isolation without Lab context
- Insisted on mock-first build to avoid burning subscription costs
- Recognized props "must be GOOD at launch" while accepting "gets better over time"
- Identified Search & Filter as critical (was almost forgotten)
- Specified stats-focused filters (different from Daily Edge's sharp focus)

### Daniel's Existing Scores Model
Daniel uses his existing manual scores model — won't automate it in V1:
- Uploads scores model daily as decision engine
- System pulls full MLB slate automated
- Sharp signals automated
- Convergence detection: model + sharp signals = surface best picks
- "Daniel's model is the brain, sharp signals are the validation"

Current Daniel scores model output sample includes: Away Team, Home Team, NRFI Pred (green/red), Confidence %, Away Runs, Home Runs, Total Runs, O/U Lean, Confidence %, ML Winner, Confidence %

---

## 2. BUSINESS MODEL & ECONOMICS

### Current Pricing
- $25/mo charter members
- $35/mo standard members

### Proposed At Launch Pricing
- Keep $25/mo charter (loyalty)
- Raise standard to $45-49/mo

### Economics At Different Member Counts
| Members | Revenue | Margin | Margin % |
|---------|---------|--------|----------|
| 20 ($500) | $500/mo | $186/mo | 37% |
| 30 ($750) | $750/mo | $436/mo | 58% |
| 40 ($1000) | $1000/mo | $686/mo | 69% |
| 50 ($1250) | $1250/mo | $936/mo | 75% |

---

## 3. TECH STACK — LOCKED

### Development Stack
- **Framework:** Next.js 16.2.6 (App Router, TypeScript, Tailwind v4)
- **Hosting:** Vercel
- **Repo:** github.com/oddsphereai-sketch/oddsphere
- **Local Path:** /Users/danielmengel/Projects/oddsphere
- **Machine:** Mac Apple Silicon, zsh, Node v24.15.0
- **Claude Code:** v2.1.142

### Backend & Data
- **Database:** Supabase Postgres
  - Project ID: jounoyrkcirgmyjccxll.supabase.co
  - Current tier: FREE (NO tables yet)
  - Free tier: 500MB DB, 5GB bandwidth, plenty for build
  - Upgrade to Pro at launch ($25/mo)
- **Auth:** Whop (existing) + future Supabase Auth integration

### Production Stack At Launch (~$314/mo)
| Service | Cost | Status |
|---------|------|--------|
| Vercel Pro | $20 | Upgrade at launch |
| Supabase Pro | $25 | Upgrade at launch (free during build) |
| BALLDONTLIE GOAT MLB | $39.99 | Subscribe after verifying via 48-hr trial |
| SharpAPI Pro | $229 | Subscribe after verifying via 3-day trial |
| OpenWeather Free | $0 | Already available |
| FanGraphs Park Factors | $0 | Public data |
| **TOTAL** | **~$314/mo** | |

---

## 4. PRODUCT VISION — LOCKED

### Three Core Lab Pages
1. **Daily Edge** — Sharp signals + line movement (where market intel matters)
2. **Player Props** — Stats + matchups + conditions (where the model edge lives)
3. **Tracking** — Honest visualization, no aggregates, per-sport always

### Plus
4. **My Bets** — User-pinned predictions for personal tracking

### Sport Coverage
All 7 sports get sport selectors with "coming soon" labels in V1:
- ⚾ MLB (V1 active)
- 🏀 NBA (coming soon)
- 🏈 NFL (coming this season)
- 🏒 NHL (coming soon)
- 🏀 CBB (coming soon)
- 🏈 CFB (coming this season)
- ⚽ UCL (coming soon)

---

## 5. UI DESIGN DECISIONS — LOCKED

### Header / Navigation
- "Tools" renamed to "The Lab"
- Active state when in The Lab (underline + accent color)
- Signed out: shows "Join Premium" button
- Signed in: shows "Account" text link (simple, no avatar)
- Same nav structure across both states

### Daily Edge Card
Hierarchy:
1. Teams + logos + time pill
2. Verdict banner (when needed)
3. **Projected Final as HERO stat** (44px numbers)
4. 3 pick boxes (ML/TOTAL/NRFI) with simple status icons
5. "Show signal breakdown · N signals" link

### Sharp Signal Philosophy
- **3 states only:** 🟢 STRONG / (no banner) / 🟡 CAUTION
- **NO "LOCK" language** (protects brand)
- **NO "PASS/FADE"** (undermines model — could win despite sharp disagreement)
- **CAUTION versatile** — covers mild ("mixed signals") to strong ("sharps moving against ML")
- **Card-level:** simple check/dash/warning icons (NOT specific signal-type icons)
- **Steam moves:** small purple alert strip on card when recent
- **Public smoke:** breakdown only (not card-level)
- **Cards sort by GAME TIME** (stable), NOT by signal strength (signals change throughout day)

### Daily Edge Expanded Breakdown
1. Per-pick sharp signal detail (Pinnacle, steam, +EV, splits)
2. Starting Pitchers (one-line each: name, W-L, ERA, K%) - from BALLDONTLIE
3. Weather (**CONDITIONAL** — only when notable: wind 10+, temp extreme, rain, dome) - OpenWeather
4. Lineup Updates (**CONDITIONAL** — only when scratches happen) - BALLDONTLIE
5. Line History widget (open → current, movement direction)
6. Refresh indicator (5-min update note)

### Tracking Page
- Remove ALL aggregate W-L (always by sport/league, never combined totals)
- Time flow: **Yesterday → This Week → Current Season → All-Time**
- SAME card structure across all 4 time sections (consistency for readability)
- W-L format: "51W-41L" (compact, unambiguous, kills "1,524/2,684" fraction confusion)
- **Honest bar scaling:** true percentage (50% = 50% bar)
- Color-coded: red <50%, yellow 50-52%, green >52%
- Subtle 50% marker line for breakeven
- Per-market breakdowns within sport cards (NO sport-level totals)
- Footer note explains methodology

### Player Props — Tonight's Best Mode
- Compact scannable cards
- Card hierarchy: Tier label (PREMIUM/STRONG/GOOD) + time → Player name → Matchup → Edge % (right side) → "The Bet" box (prominent but not dominant) → "Show breakdown"
- **NO stars** (capper-coded — rely on tier label only)
- **NO "Hot streak"/"Last 10 dots"/recency tags** (contradicts model methodology)
- **Realistic edges:** 3-8% typical, max ~10% (no more inflated +32%)
- Edge tiers: **PREMIUM (8%+) / STRONG (5-8%) / GOOD (3-5%)** — below 3% not surfaced

### Player Props — Search & Filter Mode
**STATS-FOCUSED, not market-focused.** Sportsbook/line movement filters belong to Daily Edge.

Structure:
- Sport selector with "coming soon" states (all 7)
- Market sub-tabs (Hits/HR/TB/K/ER)
- Search bar for players/teams
- Quick presets: "Tonight's Strongest" / "Best Matchups" / "Wind-Boosted Power" / "Sample Size Safe"
- 4 semantic filter sections:
  - **THE MODEL SAYS:** Min Edge / Tier / Hit Rate
  - **THE PLAYER:** Hand / Lineup Position / Form
  - **THE MATCHUP:** vs Pitcher Hand / Player Split / Pitcher Quality
  - **THE CONDITIONS:** Park / Weather
- Table view for filtered results
- **REMOVED from V1:** Sportsbook filter, Odds range, Line movement filter (those belong to Daily Edge)

---

## 6. BRAND VOICE DECISIONS — LOCKED

### Voice
"Premium handicapping voice, not capper voice"
- Honest tracking
- Transparent reasoning
- Calibrated confidence
- Explainability as competitive moat
- Math-based, not vibes-based

### Banned Language
- NO "lock"
- NO "hammer"
- NO "guaranteed"
- NO "fade your own model"
- NO "pass/fade"
- NO "hot streak" (recency bias)
- NO "lock of the day"

### Banned Features
- Hot streak indicators
- Best/Worst day callouts (showing worst days)
- Last 10 dots (recency bias)
- Stars on player cards (capper-coded)
- Inflated edge percentages (+32% is unrealistic)
- Sport-level aggregate totals on Tracking

---

## 7. PLAYER PROPS METHODOLOGY — LOCKED

### Approach
**Marcel-style 3-yr weighted regression (5/4/3 weights)** + log5 batter-vs-pitcher math + multiplicative context adjustments

### Math Stack
- Marcel projections for base rates
- Log5 (Bill James) for matchup math
- Multiplicative context: park, weather (temp/wind for HR only), platoon
- Distributions:
  - **Binomial** (hits)
  - **Poisson** (HR/K/ER/HA)
  - **Negative Binomial** (TB)
- De-vig with multiplicative method
- Compare to Pinnacle as fair reference

### Edge Thresholds
- **<3%:** Skip (within noise)
- **3-5%:** GOOD play
- **5-8%:** STRONG play
- **8%+:** PREMIUM play (with "verify lineup" caveat)

### Confidence Scoring
6-factor weighted formula → 1-5 stars:
1. Reliability (sample size)
2. Lineup confirmation
3. Weather certainty
4. Workload certainty
5. Market liquidity
6. Historical calibration

(Note: Stars dropped from card UI per design decision, but score still computed for filtering)

### 7 MLB Prop Markets
1. batter_hits
2. batter_total_bases
3. batter_home_runs
4. batter_rbis
5. pitcher_strikeouts
6. pitcher_earned_runs
7. pitcher_hits_allowed

### What's IN V1
- Marcel + log5 + park + temp/wind for HR + platoon
- Lineup-based PA estimation
- 6-factor confidence score
- Edge calculation with multiplicative de-vig

### What's SKIPPED For V1
- BvP (Batter vs Pitcher) — too noisy
- Umpire data
- Bullpen modeling
- Wind effects beyond HR
- Statcast advanced metrics
- Monte Carlo simulation
- Machine learning

---

## 8. LAUNCH SEQUENCE — LOCKED

### Phase A: Planning (Current Phase)
**Cost: $0**
- Polish UI (DONE)
- Methodology research (DONE)
- Database schema (DRAFT done, refine tomorrow)
- Build architecture
- Mock data shapes
- Cron job design
- Spec document for Claude Code

### Phase B: Build With Mocks
**Cost: $0**
- Claude Code builds entire system against MOCK data
- Mock data shaped EXACTLY like real API responses
- Full UI works
- Full model logic works
- Database fully populated with mocks
- Cron jobs run against mock services
- End-to-end testing complete

**CRITICAL PRINCIPLE:** Mock data drives REAL model calculations, not just fake UI outputs. The whole system runs on mock data — UI never knows the difference between mocks and real APIs.

### Phase C: Verify With Real APIs (Free Trials)
**Cost: $0 (use free trials)**
- Sign up for free tier BALLDONTLIE
- Sign up for free tier SharpAPI
- Take SharpAPI 3-day Pro trial
- Take BALLDONTLIE 48-hour GOAT trial
- Test real responses match mock shapes
- Verify NRFI/YRFI on SharpAPI
- Flip switch: mocks → real data
- Backtest props model on historical data
- Calibration validation

### Phase D: Commit + Launch
**Cost: $314/mo starts**
- Subscribe to BALLDONTLIE GOAT MLB
- Subscribe to SharpAPI Pro
- Whop auth integration
- Final QA
- LAUNCH

**Timeline: 5-9 weeks from when Claude Code build starts**

---

## 9. DATA PROVIDER STRATEGY — LOCKED

### Provider Abstraction Pattern
```
IGameDataProvider interface
├── MockDataProvider (used during build phase)
└── BallDontLieProvider (used after verification)

ISharpDataProvider interface
├── MockSharpProvider (used during build phase)
└── SharpAPIProvider (used after verification)
```

**Cron jobs, models, UI never know which provider is active.** Environment variable flip at switchover. ZERO code changes when going live.

### BALLDONTLIE Use Cases (GOAT Tier)
- Teams, Players, Games (basic info)
- Player Season Stats (3 years for Marcel)
- Player Splits (vs LHP/RHP)
- Lineups (starting lineups + batting order)
- Player Injuries (scratches)
- Pitch Type Stats (vs-pitcher matchups)
- Player Props (line aggregation for our model)
- Betting Odds (game lines)

### SharpAPI Use Cases (Pro Tier)
- Multi-book line aggregation (20+ books)
- Pinnacle fair reference (for de-vig + EV calc)
- Steam move detection
- Reverse line movement
- Sharp/public betting splits
- Line history / opening lines

### OpenWeather Use Cases (Free)
- Per-game forecasts (temp, wind speed, wind direction, conditions)
- Conditional notable weather flagging

### FanGraphs Use Cases (Free, scraped)
- 3-year rolling park factors
- Updated quarterly (slow-changing data)

---

## 10. UI POLISH — COMPLETE ✅

All 4 main pages polished and locked:

### Header / Navigation ✅
- Tools → The Lab rename
- Active state on Lab nav
- Account link replaces Join Premium when signed in

### Daily Edge ✅
- Card hierarchy (logos, scores hero, picks, breakdown link)
- Expanded breakdown (per-pick signals, pitchers, conditional weather/scratches, line history)
- Sharp signal philosophy (3 states, no LOCK, etc.)
- Sort by game time (stable)

### Tracking ✅
- Time flow (Yesterday → Week → Season → All-Time)
- Per-sport cards (no aggregates)
- Per-market breakdowns within cards
- Honest bars (true % + color coding + breakeven line)
- W-L format ("51W-41L")
- Footer methodology note

### Player Props ✅
- Tonight's Best: compact scannable cards with prominent (not hero) prop line
- Realistic edge ranges (3-8% typical)
- Tier labels (PREMIUM/STRONG/GOOD)
- NO stars, NO recency tags
- Search & Filter mode: stats-focused, 4 filter sections, table results
- Quick presets

---

## 11. DATABASE SCHEMA — 🔒 LOCKED (Day 5)

**Status:** LOCKED ✅ on May 22, 2026
**File:** `01-database-schema.md` (separate document, 927 lines, ~30KB)

### Schema Summary
- **Total tables:** 23 across 8 categories
- **Mock-first compatible:** All column names mirror BALLDONTLIE/SharpAPI shapes
- **Multi-sport extensible:** Sport column on relevant tables
- **Update cadence aligned:** Each data source maps to specific tables
- **CLV tracking:** Silent until 30 days of data minimum
- **Calibration tracking:** Pre-computed buckets, gated by sample size
- **Audit trail:** Refresh log tracks every cron job execution

### 23 Tables Breakdown
1-3: Reference (teams, players, ballparks)
4-7: Game data (games, lineups, injuries, weather)
8-11: Stats (season, splits, pitcher pitches, hitter pitches)
12-14: Betting (lines, line history, sharp signals)
15-17: Model output (game predictions, prop predictions, breakdowns)
18-19: Tracking (results with CLV, aggregates)
20-21: User (users, bet pins)
22-23: System (data refresh log, calibration buckets)

---

## 12. OPEN DECISIONS & NEXT STEPS

### Remaining Planning Sessions (in order)
1. **Refine database schema** (continue from draft)
2. **Mock data shapes** (match real API responses exactly)
3. **Build architecture** (file organization, abstractions, data services)
4. **Cron job design** (what runs when, what each does)
5. **Spec document** (comprehensive guide for Claude Code)

### Open Questions To Resolve
1. Exact field names from BALLDONTLIE Player Splits endpoint
2. Exact field names from BALLDONTLIE Lineups endpoint
3. Exact prop_market values BALLDONTLIE uses
4. Exact SharpAPI sharp signal endpoint shapes
5. Park factor source + update frequency (FanGraphs)
6. Multi-sport schema extensibility (NBA/NFL/etc.)

### Decisions To Make
- How granular should mock data be? (Full 30-team rosters? Partial?)
- Should we use Supabase Auth or Whop-only auth initially?
- Real-time updates (Supabase Realtime) or polling? (Polling probably fine)
- Caching strategy for predictions?
- Backup strategy (Supabase Pro has daily backups)?

---

## 13. WHAT NOT TO DO (Things Explicitly Rejected)

### Brand Violations (Never Add Back)
- ❌ "LOCK" language
- ❌ "PASS/FADE" language
- ❌ "Hot streak" indicators
- ❌ "Hot markets" sections
- ❌ Worst-day callouts
- ❌ Inflated edge percentages (+32% etc.)
- ❌ Stars on player prop cards
- ❌ "Last 10 dots" visualization
- ❌ Recency-bias tags ("vs LHP", "Park" as on-card features)

### Methodology Violations
- ❌ BvP (Batter vs Pitcher) — too noisy
- ❌ Recent form as primary signal
- ❌ Hot streaks as predictive
- ❌ Sample size <300 PA without massive regression
- ❌ Showing <3% edges as actionable

### Product Violations
- ❌ Sport-level aggregate totals on Tracking
- ❌ Combining markets across sport for hit rate
- ❌ Sharp/line movement filters on Player Props (belongs to Daily Edge)
- ❌ Card-level public betting % (breakdown only)
- ❌ Sorting Daily Edge by signal strength (use game time — stable)

### Architecture Violations
- ❌ Hardcoded mock outputs (defeats purpose of mock-first build)
- ❌ Coupling UI to specific data provider (breaks mock-first)
- ❌ Building features that can't be backed by real APIs we have

---

## 14. REFERENCE MATERIAL

### Critical Context Files (Existing Lab — Unchanged)
- `app/lab/page.tsx` (hidden route, noindex, Suspense wrapper)
- `app/lab/LabApp.tsx` (section routing, sport state, drill-down)
- `app/lab/lib-shim.ts` (Supabase re-export)
- `app/lab/data/mockData.ts` (Sport types, MLB props data)
- `app/lab/data/dailyEdgeMockData.ts` (15 MLB games)
- `app/lab/data/trackingMockData.ts` (17 sport×market tallies)
- `app/lab/components/`: Icon.tsx, LabNav.tsx, SportSelector.tsx, PropTabs.tsx, ModeToggle.tsx, TonightsBestView.tsx, SearchFilterView.tsx, PlayerPropCard.tsx, PlayerDrillDown.tsx, ComingSoonState.tsx, DailyEdgeView.tsx, DailyEdgeLegend.tsx, SimpleDailyEdgeCard.tsx, TrackingView.tsx, DailyEdgeStub.tsx (unused), MyBetsStub.tsx
- `/Users/danielmengel/Projects/oddsphere/.env.local` (real Supabase keys, gitignored)
- Local git: 5 commits ahead of origin/main, NOT pushed

### Previous Session Transcripts
- `/mnt/transcripts/2026-05-21-20-51-45-2026-05-21-oddsphere-lab-day-4-design-polish.txt` (today's session)
- `/mnt/transcripts/2026-05-21-15-09-48-oddsphere-lab-day-4-data-stack-research.txt` (data stack research)
- See journal.txt for full catalog

### API Documentation Reference
- BALLDONTLIE: https://mlb.balldontlie.io
- BALLDONTLIE OpenAPI: https://www.balldontlie.io/openapi/mlb.yml
- SharpAPI: https://docs.sharpapi.io/
- SharpAPI base URL: api.sharpapi.io
- OpenWeather: https://openweathermap.org/api
- FanGraphs Park Factors: https://www.fangraphs.com/guts.aspx?type=pfh

### Key Numbers To Remember
- 25K+ tracked predictions to date
- 20 current paying members
- $314/mo production stack
- 60.8% MLB lifetime hit rate (example from earlier mock data)
- 69% NBA ML lifetime hit rate
- 5-9 weeks from build start to launch
- 3% minimum edge threshold
- 6-factor confidence formula
- 7 prop markets, 7 sports total

---

## INSTRUCTIONS FOR FUTURE SESSIONS

### At Start Of Every Session:
1. **Read this document FIRST** before responding to Daniel
2. **Read the database schema draft** if working on data/build planning
3. **Check the transcript catalog** for any newer decisions
4. **Acknowledge what's locked vs. open** so Daniel doesn't have to re-explain

### When Making New Decisions:
1. **Check this document** to ensure consistency
2. **Update this document** with the new decision (or note to update)
3. **Flag if a decision contradicts** something previously locked
4. **Treat banned items as truly banned** — don't quietly bring them back

### When In Doubt:
- Default to honest tracking + brand integrity
- Default to math-based reasoning over vibes
- Default to less features done well over many features done poorly
- Default to asking Daniel rather than assuming
- Default to the documented decision rather than improvising

### Communication Style With Daniel:
- He likes: 🎯 emoji intro + 💜 sign-off + 💎 for callouts
- He likes: Decision options as A/B/C with recommendations marked ⭐
- He likes: Honest assessments, not flattery
- He likes: Bullet points for clarity but not overuse
- He values: Brand integrity over feature inflation
- He values: Discipline over speed
- He uses: "alright lets do it" / "I trust ya" / "lets see it" — means proceed with rec

---

**END OF FOUNDATION DOCUMENT**

This document is the project's memory. Update it as decisions are made. Reference it whenever starting a new session.
