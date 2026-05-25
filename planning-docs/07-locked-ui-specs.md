# Oddsphere AI Lab — Locked UI Specifications

**Purpose:** Single source of truth for all UI/design decisions across the Lab. Reference this BEFORE making any visual changes, polishing components, or kicking off design work.

**Last Updated:** Day 6 (May 23, 2026) — after Phase 4 + Phase 5A-5E.1 build sessions.

**Status:** SUPERSEDED for product scope, page list, footer copy, and V1 boundaries by [`08-locked-build-spec-v2.1.md`](./08-locked-build-spec-v2.1.md). This document remains AUTHORITATIVE for Lab-internal visual + interaction details (card layouts, drill-downs, typography rules, signal-language copy). When the two docs disagree on what ships in V1 or how the public site is structured, V2.1 wins.

> ⚠️ **Read order for any UI change going forward:**
> 1. Open `08-locked-build-spec-v2.1.md` first — confirm the page/feature is in V1 scope.
> 2. Then use this doc for the per-component visual + interaction spec.
> 3. If V2.1 is silent on a visual detail covered here, this doc still holds.

---

## TABLE OF CONTENTS

1. Header / Navigation
2. Daily Edge Page
3. Daily Edge Card Spec
4. Sharp Signal Philosophy
5. Daily Edge Drill-Down
6. Tracking Page
7. Tracking Data Structure
8. Player Props — Tonight's Best Mode
9. Player Props — Search & Filter Mode
10. Brand Voice — Banned Items
11. Typography & Color System
12. V1 Carve-Outs & Deferred Features
13. Phase 5 Visual Reconciliation Checklist

---

## 1. HEADER / NAVIGATION

### Marketing Site Nav (Public, Logged Out)
[Logo] Home | Picks | Track Record | 🔒 The Lab | Join Premium
"Tools" link is REMOVED → replaced with "The Lab" (with lock icon or premium badge)
Non-members clicking The Lab → see teaser/preview + Join CTA (Phase 8)
Members clicking The Lab → enter the full Lab

### Lab Nav (Inside Lab, Members)
[Logo Oddsphere]  [Daily Edge] [Player Props] [Tracking] [My Bets]  [Refresh Indicator]  [Account]
Active section: underline + accent color (violet)
"Account" text link (NOT avatar/initials per Day 4 decision)
Refresh indicator (added in 5E) lives top-right of nav

### Mobile Nav
Hamburger menu with sections OR top tabs scrolling horizontally
Refresh indicator stacks below tab row (per 5E LabNav implementation)

---

## 2. DAILY EDGE PAGE

### Page Header
Title: "Daily Edge"
Subtitle / date line: "[Day], [Month] [N] · [N] [SPORT] games tonight · sorted by start time"

### Sport Selector
All 7 sports shown with icons
MLB live in V1, others "coming soon" state

### Sort Order (LOCKED)
Cards sort by GAME TIME (stable). Never by signal strength — signals change throughout the day, sort order should not move.

### Empty State
When no games on slate:
"No games on this slate."
"Check back after the morning slate refresh, or pick another date."
(5E.1 added: smart default to most recent slate WITH games + amber fallback banner)

### "How We Update Data" Panel (5E)
Lives at BOTTOM of Daily Edge (below games list)
Collapsible (chevron icon)
5F TODO: Condense from 9 sections to 3-4 high-level points (Daniel's feedback)

---

## 3. DAILY EDGE CARD SPEC

### Card Hierarchy (TOP TO BOTTOM)
Order matters. Each item has a visual weight.

1. TEAMS + LOGOS + TIME PILL (top row)
   - Team abbreviations + logos (when available)
   - Game start time (e.g., "7:05 PM")
   - Small time pill, not dominating

2. VERDICT BANNER (conditional — only when STRONG or CAUTION)
   - NO banner when no sharp signals (default state for most games)
   - 5F MUST FIX: currently showing CAUTION on games with no signals

3. PROJECTED FINAL — HERO STAT ⭐
   - This is the VISUAL CENTERPIECE of the card
   - 44px bold numbers (or comparable hero-stat sizing)
   - Format: AWAY 3.7 — 4.6 HOME or stacked
   - Members care MOST about "what does the model project for this game"
   - 5F MUST FIX: currently not the hero stat

4. 3 PICK BOXES (ML / TOTAL / NRFI)
   - Each box shows: Market label, Pick + confidence %, Simple status icon (check / dash / warning)
   - Use ACTUAL SPORTSBOOK LINE for totals, not model projection
   - 5F MUST FIX: currently shows model projection as the line

5. "Show signal breakdown · N signals" LINK (bottom)
   - Tap to expand drill-down
   - N = count of signals across all markets
   - Smaller text, secondary action

### What NOT to do
- Show all signals on card front (only badge/banner)
- Show specific signal-type icons on card (use simple check/dash/warning only)
- Sort by signal strength
- Use "LOCK" or "HAMMER" or "GUARANTEED" language
- Display model projection AS the line for totals
- Have a flat hierarchy where everything feels the same weight

---

## 4. SHARP SIGNAL PHILOSOPHY

### Three States ONLY

STRONG (green banner): Sharp signal SUPPORTS the model's pick on at least one market
NO BANNER (default): No sharp signals detected at all
CAUTION (amber/rose banner): Sharp signal AGAINST the model's pick on at least one market

### Critical Principle
ABSENCE of signal ≠ NEGATIVE signal.
Most games have no sharp signals at all. These show normally, with no banner, no warning. The model's pick speaks for itself.

### Steam Moves
Small purple alert strip on card when recent steam detected
Not a banner — just a small marker

### Public Smoke
Breakdown only (NOT card-level)
Reserved for drill-down view
Phase 7+ feature (requires premium data not in V1)

### Banned Language
- "LOCK"
- "HAMMER"
- "GUARANTEED"
- "PASS / FADE"
- "FADE YOUR OWN MODEL"
- Multiple fire emojis
- "LOCK OF THE DAY"

---

## 5. DAILY EDGE DRILL-DOWN

When member clicks "Show signal breakdown":

Section 1: Per-Pick Sharp Signal Detail
- Each market (ML / TOTAL / NRFI) shows its signals separately
- Pinnacle moves, steam, +EV, splits
- Plain-English summary at top, technical details collapsible

Section 2: Starting Pitchers
- One line each: name, W-L, ERA, K%
- Data source: BALLDONTLIE (Phase 7), mock data in V1

Section 3: Weather (CONDITIONAL)
- ONLY show when notable: Wind 10+ mph, Temperature extreme, Rain, Dome
- Hide entirely otherwise
- Data source: OpenWeather (Phase 7)

Section 4: Lineup Updates (CONDITIONAL)
- ONLY show when scratches happen, hide otherwise
- Data source: BALLDONTLIE (Phase 7)

Section 5: Line History Widget
- Opening line → current line
- Movement direction (arrow), simple visual

Section 6: Refresh Indicator
- Now lives in nav (5E moved it out of drill-down)

---

## 6. TRACKING PAGE

### Page Structure (TOP TO BOTTOM)

A. Header: "📈 Track Record" h1, Subtitle: "Every prediction tracked. Every result verified."

B. Summary Row — 4 Stat Cards (2×2 mobile, 1×4 desktop):
- This Week: "X-Y" headline, "XX% hit rate · all sports" subtitle
- Yesterday: "30-11" headline, "73.2% hit rate · 6 markets" subtitle
- All-Time: "11,022-7,500" headline, "59.5% hit rate · 18.5K predictions" subtitle
- Current Streak: "🔥 6W" headline, "Current streak" subtitle

C. Yesterday's Recap (HERO 1):
- Heading: "🎯 Yesterday — May 19"
- Big summary: "30 wins · 11 losses · 73.2% hit rate"
- Sport sections grouped by sport (NBA + MLB), each with market rows
- Mobile: stack vertically. Desktop: 2-column grid.

D. This Week Tally (HERO 2):
- Heading: "📅 This Week" + date range
- Sport × market table for the rolling 7 days
- Columns: Sport icon + name | Market | This Week | Hit Rate | Visual bar
- Best/worst day callouts below

E. 30-Day Chart:
- Heading: "📊 Last 30 Days · {X}-{Y} ({Z}% hit rate)"
- 30 vertical bars showing daily hit rate
- Colors: Emerald >55%, Amber 45-55%, Faint rose <45%
- Dashed 50% reference line

F. Calibration Display (5E NEW):
- Heading: "📊 Calibration — How Honest Are We?"
- Hero callout with the headline finding
- Table of all displayable buckets
- Color-coded delta
- CRITICAL: Game-level predictions only. NO prop calibration in V1.

G. All-Time Record (THE BIG MATRIX):
- Heading: "🏆 All-Time Record"
- Full table: Sport icon + market | Lifetime | Current Season | Weekly
- ALL 17 sport-market combinations from Daniel's spreadsheet (after 5G baseline import)
- Rows grouped by sport order: MLB, NBA, CBB, NFL, CFB, NHL, UCL
- Empty cells show "—" muted gray

H. Footer Note:
Italic gray text, centered: "Track record auto-updates every morning at 3am ET. Every prediction is logged before games start and marked W/L based on final scores. No edits, no cherry-picking."

### Tracking Page V1 Constraints
- NO sport-level aggregate totals (always per-market)
- NO worst-day callouts in summary cards (only inline)
- NO player props tracking in V1 (deferred to Phase 9+)
- Honest bar scaling (50% = 50% bar visually)
- W-L format: "51W-41L" (compact)
- Honest empty states for offseason sports

---

## 7. TRACKING DATA STRUCTURE

### The 16 Markets to Track (V1)
- NFL: ML, O/U
- CFB: ML, O/U
- NBA: ML, O/U
- CBB: ML, O/U
- MLB: ML, NRFI/YRFI (combined), NRFI, YRFI, O/U
- NHL: ML, O/U
- UCL: ML, Double Chance

### Time Windows
1. Lifetime — career total
2. Current Season — this sport's active season only (null if offseason)
3. Weekly — rolling 7 days (null if no picks)

### V1 Migration (Phase 5G)
- Daniel sends spreadsheet of all 16 markets
- System imports as tracking_baseline table
- Going forward: baseline + prediction_results combine for lifetime/season totals
- Weekly always starts fresh from launch

### What's Excluded
- Player props tracking (deferred, prop model unproven)
- Individual pick history (Daniel only has aggregates)

---

## 8. PLAYER PROPS — TONIGHT'S BEST MODE

### Card Hierarchy
1. Tier label (top): PREMIUM / STRONG / GOOD with color coding
2. Time + game matchup
3. Player name (prominent)
4. Matchup detail (e.g., "vs Hunter Greene")
5. Edge % (right side, prominent)
6. "The Bet" box (the actual prop line — prominent but NOT dominant)
7. "Show breakdown" link

### Card Design Rules
- NO stars (capper-coded — rely on tier label only)
- NO "Hot streak" / "Last 10 dots" / recency tags
- NO inflated edges (+32% banned, max ~10% realistic)
- Compact, scannable
- Tier label is primary signal
- Realistic edges: 3-8% typical

### Edge Tier Thresholds
- PREMIUM: 8%+ (with "verify lineup" caveat)
- STRONG: 5-8%
- GOOD: 3-5%
- SKIP: <3%

### Filter Chips (Signals)
Currently visible but NON-FUNCTIONAL in V1.
10 chips: 🔥 Hot, 🤚 vs LHP / vs RHP, 💨 Wind Out / Wind In, 🏟️ Park, ❄️ Cold, ⚠️ Warning, 🛌 Rest Advantage, 🤝 Platoon
5F implements signal derivation service with mock data to make chips functional.

---

## 9. PLAYER PROPS — SEARCH & FILTER MODE

### Philosophy
STATS-FOCUSED, not market-focused. Sportsbook/line movement filters belong on Daily Edge.

### Structure
1. Sport selector with "coming soon" states (all 7)
2. Market sub-tabs (Hits / HR / TB / K / ER / RBI / HA)
3. Search bar for players/teams
4. Quick presets: "Tonight's Strongest", "Best Matchups", "Wind-Boosted Power", "Sample Size Safe"

### 4 Semantic Filter Sections
1. THE MODEL SAYS: Min Edge, Tier, Hit Rate
2. THE PLAYER: Hand (L/R), Lineup Position, Form
3. THE MATCHUP: vs Pitcher Hand, Player Split, Pitcher Quality
4. THE CONDITIONS: Park, Weather

### Results Display
Table view (compact, sortable)
All 4 tiers visible (not just Premium/Strong)
Click row → drill-down

### NOT Included in Search & Filter (V1)
- Sportsbook filter
- Odds range
- Line movement filter
(Those belong on Daily Edge)

---

## 10. BRAND VOICE — BANNED ITEMS

### Banned Language
- "Lock", "Hammer", "Guaranteed"
- "Fade your own model", "Pass/Fade"
- "Hot streak" (recency bias)
- "Lock of the day"
- Multiple fire emoji explosions
- "Big bois" / "smash" / capper-speak

### Banned Features
- Hot streak indicators
- Best/Worst day callouts in summary cards (inline only)
- Last 10 dots visualization (recency bias)
- Stars on player prop cards (capper-coded)
- Inflated edge percentages (>10% unrealistic)
- Sport-level aggregate totals on Tracking
- "Lock of the day" type sections

### Allowed Voice
- "Premium handicapping voice, not capper voice"
- Honest tracking
- Transparent reasoning
- Calibrated confidence
- Math-based, not vibes-based
- Conversational reasoning

---

## 11. TYPOGRAPHY & COLOR SYSTEM

### Typography Hierarchy
H1: 32-40px Bold (Page titles)
H2: 24-28px Semibold (Section headers)
H3: 18-20px Semibold (Card titles)
H4: 14-16px Semibold (Sub-labels)
Body: 14-16px Regular
Small: 12-14px Regular
Micro: 11-12px Regular

### Numbers (CRITICAL)
Hero stat: 36-48px Bold (Projected scores — 44px target)
Large stat: 24-32px Semibold (Confidence, edge)
Medium stat: 16-20px Semibold (Secondary stats)
Small stat: 12-14px Regular (Inline numbers)

### Special
- Tabular figures for all numbers (alignment)
- All caps + letter-spacing for category labels

### Color System
Background: bg-gradient-to-br from-gray-900 to-gray-950
Borders: border-gray-800 (hover: border-gray-700)
Cards: rounded-xl with subtle inset shadow

Semantic Colors:
- Emerald: positive / wins / supporting signal
- Rose: negative / losses (gentle)
- Amber: warning / updating / mixed / fallback
- Violet: accents / highlights / model focus

### Feel
"Clean / minimal / Linear-style" — NOT spreadsheet-y, NOT rainbow.

---

## 12. V1 CARVE-OUTS & DEFERRED FEATURES

### V1 Active
- MLB live (others "coming soon")
- Scores model picks (16 markets across 7 sports for tracking)
- Sharp signals (when present — proper STRONG/none/CAUTION)
- Player Props research (NEW product, no track record needed)
- Tracking page (16 game-level markets, baseline import)
- Calibration display (game-level only)
- Refresh indicator
- How We Update panel (condensed in 5F)

### V1 Excluded
- Player props aggregate tracking (prop model unproven)
- Public smoke / public betting % (no API data source)
- Sharp strength tiers (1-5 scale — Phase 7+)
- ROI / CLV tracking (Phase 9+)
- Units / profit tracking (banned)

### Deferred to Phase 7 (Real APIs)
- Real BALLDONTLIE data
- Real SharpAPI data
- Real OpenWeather data
- Real FanGraphs park factors
- Signal derivation service with real data (mock in 5F)
- Per-game adaptive refresh scheduling

### Deferred to Phase 7.5 (After Real-API Cutover)
- Tracking baseline import (was 5G in the original roadmap; moved post-7 to avoid a hybrid mock+real-data tracking state). Daniel's spreadsheet of lifetime + season totals for all 16 markets gets imported as `tracking_baseline` rows on the same day real scores-model uploads start landing. Combining the baseline before real APIs are flowing would pollute prediction_results aggregations with mock + real picks indistinguishably; deferring keeps the cutover clean.

### Deferred to Phase 8 (Launch Prep)
- Whop OAuth integration
- Auth gate on /lab/* routes
- Non-member teaser/preview page
- Marketing site nav update (Tools → 🔒 The Lab)
- Production deployment

### Deferred to Phase 9+
- Player props track record with ROI metrics
- Closing line value tracking
- Multi-sport CBB admin UI (in time for Nov 2026 season)
- Public betting % integration

---

## 13. PHASE 5 VISUAL RECONCILIATION CHECKLIST

This is the 5F audit checklist.

### Daily Edge Card
- [ ] Projected final as HERO stat (44px)
- [ ] Verdict logic: 3 states (STRONG / no banner / CAUTION)
- [ ] O/U pick shows actual sportsbook line, not model projection
- [ ] Card sort by game time
- [ ] Sharp signal count link at bottom ("Show signal breakdown · N signals")
- [ ] Simple status icons (check/dash/warning) NOT specific signal-type icons
- [ ] Cards display correctly across mobile + desktop

### Daily Edge Drill-Down
- [ ] Per-pick sharp signal detail
- [ ] Starting pitchers section
- [ ] Weather (CONDITIONAL — only when notable)
- [ ] Lineup updates (CONDITIONAL — only when scratches)
- [ ] Line history widget

### Tracking Page
- [ ] 4 stat cards (Week / Yesterday / All-Time / Streak)
- [ ] Yesterday's Recap with sport sections
- [ ] This Week Tally as sport × market table
- [ ] 30-day bar chart with proper coloring
- [ ] Calibration Display (5E) between 30-day and All-Time
- [ ] All-Time Record matrix (will have all 17 rows after 5G)
- [ ] Footer note about auto-updates

### Player Props Tonight's Best
- [ ] Card hierarchy (tier label, player, matchup, edge %, bet box, breakdown link)
- [ ] No stars, no recency tags
- [ ] Realistic edges (3-8% typical)
- [ ] PREMIUM/STRONG/GOOD tier visualization

### Player Props Search & Filter
- [ ] STATS-focused filters (4 sections)
- [ ] Quick presets visible
- [ ] Table view for results
- [ ] Signal filter chips functional (after 5F signal derivation)
- [ ] NO sportsbook/odds/line movement filters here

### Navigation
- [ ] Refresh indicator in top-right (5E added)
- [ ] Active section underline + accent color
- [ ] Account link (not avatar)
- [ ] Mobile responsive

### Brand Voice
- [ ] No "LOCK" / "HAMMER" / "GUARANTEED" anywhere
- [ ] No "hot streak" recency bias
- [ ] No stars on prop cards
- [ ] HowWeUpdatePanel condensed to 3-4 points

### Data Correctness
- [ ] slate_date works correctly (5E.1 done)
- [ ] URL date param respected (5E.1 done)
- [ ] Smart default date with fallback banner (5E.1 done)
- [ ] Player props tracking excluded from V1
- [ ] Calibration filtered to game-level only

---

## INSTRUCTIONS FOR USE

### Before Making Any UI Change:
1. Read the relevant section above to confirm what's locked
2. Check the V1 Carve-Outs list to confirm scope
3. Check the Banned Items list to avoid regressions
4. Update this doc if a new decision is made (with date noted)

### When In Doubt:
- Default to the documented decision
- Don't improvise visual treatments
- Don't bring back banned features "subtly"
- Ask Daniel rather than assume
