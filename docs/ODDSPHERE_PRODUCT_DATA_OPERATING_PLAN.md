# OddSphere Product + Data Operating Plan

Status: draft operating plan  
Date: 2026-06-24  
Purpose: align product goals, provider usage, user-facing claims, and implementation order before adding Playbook API or changing SharpAPI usage.

## Executive Recommendation

OddSphere should treat Playbook and SharpAPI as different tools, not interchangeable vendors.

Playbook is the better near-term stability and coverage layer. It can make OddSphere feel more complete across sports, especially where the current app has thin market context. Its strongest immediate value is current main lines, public betting splits, WNBA splits, MLB starters, MLB weather, injuries, team stats, recent form, head-to-head, and league/team metadata.

SharpAPI is the sharp-market and sportsbook microstructure layer. It matters when OddSphere needs per-book odds, player props odds, Pinnacle/no-vig style fair pricing, +EV opportunities, closing prices, delta polling, streaming, arbitrage, middles, or low-hold detection.

The clean path is:

1. Buy or enable Playbook only if we can run it in shadow mode first.
2. Use Playbook to fill coverage and context gaps, starting with WNBA public splits and MLB context.
3. Keep SharpAPI optional and gated behind features that actually require it.
4. Do not call something "sharp", "steam", "reverse line movement", "Pinnacle", "CLV", or "closing-line value" unless the underlying data truly supports that claim.

## Product Thesis

OddSphere should be a disciplined betting research tool. It should help a user answer:

- What is the best angle on this game?
- Why does the model like it?
- What does the market say?
- Is the public on the same side or the other side?
- Is the data good enough to act on?
- What changed since we first observed the game?
- Did our process actually perform over time?

OddSphere should not pretend to guarantee profit. Profitability comes from calibration, restraint, honest labels, clean tracking, and refusing to promote weak signals as strong ones.

The user experience should feel sharp because it is honest and selective. A quiet "no clean angle" is better than a loud pick built on thin data.

## User-Facing Truth Rules

These rules should govern every API integration and UI label.

- "Best Angle" should require model edge, market sanity, sufficient data quality, and no major contradictory context.
- "Lean" can be shown when the model likes something but the supporting market/context data is weaker.
- "Public split" or "public money" means betting percentage and money/handle percentage only.
- Playbook public splits alone should not be labeled as steam, reverse line movement, Pinnacle agreement, or +EV.
- SharpAPI +EV/no-vig/closing/per-book data can support stronger sharp-market language, but only when the exact field is present.
- No CLV or "beat the close" claims until OddSphere stores reliable closing-line snapshots.
- No fake opener movement. If the first observed line is all we have, the UI should say or imply first observed, not opening line.
- No player prop product claims until prop odds, prop model inputs, and prop tracking all exist.
- A missing data lane should downgrade confidence or data quality, not get papered over with copy.

## Market Data Discipline

OddSphere should not treat all line data as interchangeable. A betting product is only useful if the same market means the same thing every time.

The core rule: line movement must compare like with like.

Valid line movement examples:

- DraftKings moneyline first observed compared with DraftKings moneyline current.
- FanDuel total first observed compared with FanDuel total current.
- `playbook_consensus` spread first observed compared with `playbook_consensus` spread current.
- A documented multi-book consensus open compared with the same documented multi-book consensus current.

Invalid line movement examples:

- DraftKings open compared with FanDuel current.
- SharpAPI per-book open compared with Playbook consensus current.
- A consensus line compared with a specific sportsbook line.
- A first observed line described as an opening line.

Recommended source hierarchy:

1. Canonical sportsbook line: one named sportsbook chosen per sport/market for movement and tracking.
2. Best available price: used for user betting guidance, but not for movement unless tracked as its own series.
3. Consensus line: useful as market context and fallback, but must be labeled as consensus.
4. Sharp/fair price: useful for EV or model comparison, but not the same as a book line.

Every stored line should carry:

- Provider.
- Sportsbook or consensus source.
- Market type.
- Selection.
- Line value.
- Price.
- Observed timestamp.
- Event start time.
- Whether it is current, first observed, best available, consensus, or closing.

Every displayed movement label should know which source series it came from. If OddSphere cannot prove source consistency, it should say "market context" instead of "line movement."

## Current OddSphere Shape

The repo already has a useful architecture for this, but the data contracts matter.

Core lanes:

- Slate and games: which matchups exist today.
- Current odds and lines: market prices for moneyline, spread/run line/puck line, total, and sometimes first-inning.
- Public splits: bets percentage and money/handle percentage by market.
- Sharp signals: fair price, +EV, steam, reverse line movement, low hold, arbitrage, and similar market intelligence.
- Context: injuries, starters, weather, park factors, team stats, recent form, head-to-head.
- Model output: projected win probability, totals, first-inning estimates, grades, confidence.
- Tracking: results, prediction records, held state, grading, future CLV/ROI when supported.
- UI DTO: Daily Edge cards, market quality labels, public splits, market source, verdict, and explanatory copy.

Important current facts:

- Provider routing lives in `/Users/danielmengel/Projects/oddsphere/lib/providers/factory.ts`.
- Current real odds and sharp signal provider paths are SharpAPI-oriented.
- The odds provider contract in `/Users/danielmengel/Projects/oddsphere/lib/providers/interfaces/IOddsProvider.ts` expects sportsbook-level line records.
- The sharp signal contract in `/Users/danielmengel/Projects/oddsphere/lib/providers/interfaces/ISharpSignalProvider.ts` expects fields that Playbook does not fully provide, such as EV, steam, reverse line movement, and sharp money indicators.
- WNBA currently has a Daily Edge path and SharpAPI odds ingestion, but no public splits lane.
- The Daily Edge DTO already has places for public splits, market source, market data quality, and sharp signals. We do not need to invent a new UI philosophy to use Playbook well.

## Provider Ownership Matrix

### Playbook Primary Ownership

Use Playbook first for:

- Public betting splits for main markets.
- WNBA public splits.
- Broad current main-line coverage when per-book precision is not required.
- League/team metadata.
- Injuries.
- Team stats.
- Recent form.
- Head-to-head.
- MLB probable starters.
- MLB pitcher season stats.
- MLB venue weather and weather impact context.
- Historical public splits where available.

Playbook should be described internally as a coverage, context, and public-market provider.

### SharpAPI Primary Ownership

Use SharpAPI first for:

- Per-book odds.
- Player prop odds.
- Pinnacle or sharp-book comparisons.
- No-vig fair odds.
- +EV opportunities.
- Closing odds.
- Delta polling for changed odds.
- Streaming odds or opportunity updates.
- Arbitrage, middles, and low-hold opportunity feeds.

SharpAPI should be described internally as the sportsbook microstructure and sharp-pricing provider.

### Existing Sources

Keep existing sources where they are already working or where they are free and reliable:

- Ball Don't Lie for supported schedules, teams, players, and stats.
- ESPN as a fallback for scoreboard, injuries, and probable pitchers where needed.
- MLB Stats API for MLB-specific game state and line score needs.
- NHL public API and MoneyPuck for NHL data.
- Basketball Reference-derived data where the current NBA model depends on it.
- OpenWeather only where Playbook does not cover the specific weather need or as a fallback.

## Verified Playbook Coverage

Live trial-key probe on 2026-06-24 confirmed:

- `/v1/health` and `/v1/me` work.
- Account tier was free trial with a 500 monthly limit.
- `/v1/splits` and `/v1/lines` returned data for MLB, NFL, NCAAF/CFB, and WNBA.
- MLB returned 15 split rows and 15 line rows.
- WNBA returned 8 split rows and 8 line rows.
- NFL returned 75 split rows and 75 line rows.
- NCAAF/CFB returned 78 split rows and 78 line rows.
- NBA, NHL, NCAAB/CBB, and MLS returned no same-day rows in that probe.

Documented Playbook endpoints verified or identified:

- Health.
- Me.
- Teams.
- Team Stats.
- Injuries.
- Splits.
- Splits History.
- Odds Games.
- Lines.
- Games.
- Recent Form.
- Head-to-Head.
- MLB Pitcher Stats.
- MLB Starting Pitchers.
- MLB Ballpark/Venue Weather.
- MLB Strikeout Predictor.

Important limitation: Playbook's current line data is not a substitute for sportsbook-by-sportsbook odds. It should not overwrite per-book line records unless clearly stored as consensus/provider aggregate data.

Important limitation: Playbook's public splits are not the same thing as steam, reverse line movement, CLV, or +EV.

## Verified SharpAPI Coverage

SharpAPI documentation indicates it can cover:

- `/odds`: current per-book odds snapshots.
- `/odds/best`: best available prices.
- `/odds/delta`: changed-since odds polling.
- `/odds/closing`: closing odds snapshots on higher tiers.
- `/events`: event schedule and metadata.
- `/splits`: public betting splits from supported books on higher tiers.
- `/opportunities/ev`: +EV opportunities on higher tiers.
- `/opportunities/arbitrage`: arbitrage opportunities.
- `/opportunities/low_hold`: low-hold opportunities.
- `/stream`: server-sent event stream for odds and opportunities with the streaming add-on or enterprise access.

SharpAPI documentation also indicates player props are available through odds market aliases such as `props`, meaning it is the more natural future provider for a general player props product.

Important limitation: existing OddSphere code should not assume SharpAPI directly provides final "steam" or "reverse line movement" labels unless the endpoint/tier actually provides the necessary movement data. If those labels are needed, OddSphere should compute and audit them from odds history or delta data.

## Integration Strategy

### Phase 0: Freeze Claims

Before integration work, audit UI copy and provider-derived labels.

Do now:

- Keep sharp-market labels conservative.
- Keep Playbook out of production UI claims until a shadow run proves coverage.
- Make sure "public splits" and "sharp signals" remain separate concepts.

### Phase 1: Playbook Shadow Client

Build a read-only Playbook client and coverage script.

Requirements:

- No production UI change.
- No model weighting change.
- No overwriting existing line rows.
- Redact API keys from logs.
- Produce daily coverage by sport, market, endpoint, and game match rate.

This phase answers: does Playbook reliably cover the sports and markets OddSphere needs on real slates?

### Phase 1B: Canonical Line Source Policy

Before using Playbook lines in production, define the line source policy by sport and market.

Required decisions:

- Canonical sportsbook for movement where per-book data exists.
- Consensus fallback source where per-book data does not exist.
- Whether best-price shopping is displayed separately from movement.
- Whether model calibration uses canonical, consensus, or no-vig/fair prices.
- How first observed, current, and closing prices are stored.

Acceptance criteria:

- No movement calculation mixes sportsbooks.
- No movement calculation mixes consensus and per-book series.
- The UI can distinguish "best available price" from "tracked market movement."
- Historical records retain enough source metadata to debug a displayed move later.

### Phase 1C: Model Impact Audit

Before Playbook public splits influence any production grade, verdict, Best Angle, Caution, No Play, confidence, or tracking output, run a before/after impact audit.

Required comparisons:

- Current SharpAPI public split fields versus Playbook public split fields.
- Current `sharp_signals` rows versus proposed Playbook-backed public split rows.
- Current `market_signal` outputs versus proposed outputs.
- Current per-market grades versus proposed grades.
- Current Best Angle / Lean / Watchlist / Caution selections versus proposed selections.
- Current public-smoke flags versus proposed public-smoke flags.
- Any confidence cap, hold, no-play, or reviewer intervention that changes because the public data changed.

Acceptance criteria:

- Every changed pick/grade can be explained by a specific field difference.
- No Playbook field is treated as EV, steam, RLM, Pinnacle, CLV, or sportsbook movement.
- Public-split improvements raise data completeness without silently changing sharp-market claims.
- Operator can review a diff report before member-facing rollout.

### Phase 1D: Market And Sharp Signal Correctness

Before full live rollout, validate the whole market-intelligence chain.

Required checks:

- Public splits classify only public bet and money/handle context.
- `public_smoke` uses ticket-heavy and flat-money logic only.
- `market_confirmed` and `market_resistance` require true sharp/fair-price/movement evidence, not public split data alone.
- Steam and reverse line movement are either disabled or computed from valid same-source line history.
- +EV requires fair probability/fair odds compared to current book odds.
- CLV requires stored pick price and comparable closing price.

If a provider does not supply the required field or history, the claim stays unavailable.

### Phase 2: WNBA Public Splits

Use Playbook as the WNBA public splits provider.

Requirements:

- Map Playbook WNBA games to OddSphere WNBA games.
- Store public bet and money percentages without marking them as EV, steam, or reverse line movement.
- Surface them as public-market context in Daily Edge.
- Track coverage and staleness before letting them influence grades.

This is the highest-value first feature because current WNBA public split coverage is thin and Playbook appears to cover it.

### Phase 3: MLB Context Upgrade

Use Playbook for MLB context where it is stronger or cleaner than current patched-together sources.

Candidate lanes:

- Probable starters.
- Pitcher season stats.
- Venue weather and weather impact.
- Injuries.
- Team stats.
- Recent form and head-to-head.

Requirement: each context lane should be swapped independently with fallback behavior. No big-bang replacement.

### Phase 4: Consensus Lines As Fallback

Use Playbook current lines carefully.

Recommended approach:

- Treat Playbook lines as consensus/provider aggregate lines.
- Use them as fallback or context when per-book odds are unavailable.
- Do not store them as if they came from DraftKings, FanDuel, Pinnacle, or any other specific sportsbook.
- If writing to the existing `lines` table is necessary, use a clearly named source such as `playbook_consensus` and make downstream ranking aware that it is not a real sportsbook.

Better long-term approach: store provider snapshots or market context separately from sportsbook line records.

### Phase 5: SharpAPI Retention Gate

Do not decide SharpAPI emotionally. Decide it by product need.

Keep SharpAPI if OddSphere is actively using or about to use:

- Player props odds.
- +EV detection.
- Pinnacle/no-vig fair prices.
- Per-book best-price shopping.
- Closing odds and CLV.
- Delta polling or streaming movement.
- Arbitrage, middles, or low-hold products.

Pause, downgrade, or defer SharpAPI if the current product is only showing main markets, public splits, injuries, starters, weather, and team context.

### Phase 6: Player Props

Future props should be designed as their own product lane.

SharpAPI is the likely odds source for general props. Playbook's MLB strikeout predictor may be useful as a model/context input for pitcher strikeout props, but it is not a complete props odds provider.

Do not ship props until all three exist:

- Prop odds.
- Prop model or projection logic.
- Prop result tracking.

## Do Not Do

- Do not replace SharpAPI with Playbook in one broad edit.
- Do not let Playbook consensus lines masquerade as sportsbook odds.
- Do not use public splits to claim steam or reverse line movement.
- Do not claim CLV until closing odds are stored and audited.
- Do not add player props to the UI without odds, modeling, and tracking.
- Do not let two agents edit the same provider, service, or Daily Edge route at the same time.
- Do not route Playbook data straight into grades before coverage and stale-data behavior are known.

## Execution Tickets

### T0: Provider Decision Registry

Create a small repo document or config table that lists each data lane, owning provider, fallback provider, UI claims enabled, and tables touched.

### T1: Playbook Read-Only Client

Add a typed Playbook client with endpoint-specific methods and redacted logging.

Initial methods:

- Health.
- Me.
- Lines.
- Splits.
- Splits History.
- Odds Games.
- Teams.
- Injuries.
- Team Stats.
- MLB Starting Pitchers.
- MLB Pitcher Stats.
- MLB Venue Weather.

### T2: Daily Playbook Coverage Audit

Run Playbook in shadow for at least one week.

Track:

- Games found by sport.
- OddSphere slate match rate.
- Market coverage by moneyline, spread/run line/puck line, total, and first-inning where relevant.
- Public split coverage by market.
- Staleness.
- Endpoint errors.
- Rate-limit usage.

### T3: WNBA Splits Shadow Ingest

Add WNBA Playbook splits ingestion into a clearly separated lane.

Acceptance criteria:

- Daily Edge can display WNBA public bet and money percentages.
- Existing WNBA odds/model behavior does not regress.
- No EV/steam/RLM fields are populated from Playbook splits.

### T4: UI Claim Audit

Audit Daily Edge copy and labels.

Acceptance criteria:

- Every visible sharp-market label maps to a real field.
- Missing data produces conservative language.
- Public split context is visibly distinct from sharp signal context.

### T5: SharpAPI Usage Review

After Playbook shadow coverage, decide SharpAPI tier based on actual product requirements.

Questions:

- Are we shipping props in the next build cycle?
- Are +EV and fair odds visible to users?
- Are closing odds and CLV part of the next user-facing promise?
- Are per-book prices being shown or used in best-price logic?

### T6: MLB Context Replacement

Move MLB starters, weather, injuries, and pitcher context one lane at a time.

Acceptance criteria:

- Each lane has fallback behavior.
- Each lane has freshness checks.
- Model and UI changes are separately reviewable.

## Agent Coordination Rules

This document should be the shared map for Codex, Claude, and the human operator.

For every implementation task, state:

- Data lane affected.
- Provider used.
- UI claim enabled or changed.
- Tables written.
- Rollback path.
- Files expected to change.

Only one agent should own a ticket at a time.

Avoid simultaneous edits to:

- `/Users/danielmengel/Projects/oddsphere/app/api/lab/daily-edge/route.ts`
- `/Users/danielmengel/Projects/oddsphere/lib/services/linesService.ts`
- `/Users/danielmengel/Projects/oddsphere/lib/providers/factory.ts`
- `/Users/danielmengel/Projects/oddsphere/lib/providers/interfaces/IOddsProvider.ts`
- `/Users/danielmengel/Projects/oddsphere/lib/providers/interfaces/ISharpSignalProvider.ts`
- `/Users/danielmengel/Projects/oddsphere/lib/services/wnba/*`

Claude can implement a scoped ticket. Codex should verify provider contracts, data truthfulness, and product-claim safety after each ticket.

## Operator Metrics

Track these before and after Playbook integration:

- Daily slate coverage by sport.
- Percentage of games with current lines.
- Percentage of games with public splits.
- Percentage of games with model output.
- Percentage of games with injuries/context.
- Stale data rate.
- Blank card or empty-market rate.
- Best Angle frequency by sport.
- Pick grade distribution.
- Result tracking completion rate.
- Closing-price availability once CLV exists.
- Long-term calibration by confidence bucket.

## Near-Term Decision

Buying the Playbook $99 tier is reasonable if the goal is to improve coverage and context quickly, especially for WNBA and MLB. The purchase should not be treated as permission to wire everything into production immediately.

The disciplined version is:

1. Buy or enable Playbook.
2. Run shadow coverage.
3. Ship WNBA public splits.
4. Ship MLB context lanes.
5. Reassess SharpAPI based on whether OddSphere is actively building props, +EV, closing odds, or per-book market features.

That path lets OddSphere get better quickly without becoming sloppy.
