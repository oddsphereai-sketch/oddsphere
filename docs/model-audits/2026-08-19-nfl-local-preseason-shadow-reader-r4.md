# NFL local preseason shadow reader r4

Status: local-only, fail-closed, non-actionable  
Date: 2026-08-19  
League/phase: NFL preseason  
Production board impact: zero promotions, zero demotions, zero tracked picks

## Immutable releases and sources

- Slate adapter: `balldontlie_nfl_preview_slate_2026_08_19_r1`
- Shadow projection: `nfl_preseason_local_shadow_score_baseline_2026_08_19_r1`
- Feature snapshot: `nflverse_real_results_l10_2026_08_19_r1`
- Tracking policy: `football_tracking_policy_2026_08_19_r1`
- Margin component: `football_dynamic_margin_diagonal_state_space_2026_08_19_r1`
- Pinned nflverse source checksum: `e4da26b553a34ee2699f366b70f85f4b80b147d3e5e2b7ee1c3e5ee54295a14f`

No production model identifier, writer, cron, database row, grade, stake, official
tracking registry, or `prediction_pipeline` lease changed.

## What is genuine in the local reader

- Schedule identity, provider game IDs, teams, and kickoff timestamps are read
  in one bounded BALLDONTLIE season/week request.
- NFL public Preseason Week 2 maps explicitly to BALLDONTLIE provider week 3,
  whose numbering includes the Hall of Fame Game. The raw provider week remains
  preserved for audit, while the member label follows the NFL schedule.
- Current moneyline, spread, and total pairs come from one named sportsbook per
  game. The adapter chooses the first complete row from a fixed US-book priority
  and never creates an asynchronous best-price composite.
- Provider-native opening prices are requested separately. If no row exists,
  the reader says opening unavailable and shows only the current observation.
- Public consensus and source-book split sections remain unavailable when no
  provider row exists. No percentage, movement, RLM, steam, or sharp-money label
  is inferred from price alone.
- Projected margin and home-win probability come from the previously selected
  dynamic score-history benchmark trained on 4,175 completed regular-season
  games from 2010–2025.
- Recent form, points scored, points allowed, scoring margin, game total, and
  record are calculated from each club's actual last ten completed 2025
  regular/postseason games in the checksum-pinned nflverse file.
- The total projection is the combined empirical mean of both teams' genuine
  last-ten game totals. Its uncertainty is the sample standard deviation of
  those 20 observed totals. It is visibly identified as an unvalidated baseline.
- Injury rows come only from the BALLDONTLIE NFL player-injury endpoint. Missing
  or empty rows never imply that a player is healthy.

## Why every preseason market is No Play

The score-only margin candidate did not beat the terminal market benchmark on
the untouched 2025 regular-season holdout:

- 272 games
- margin MAE: model 10.3235, market 9.7224
- home-cover Brier: model 0.2645, market 0.2496

The candidate also lacks preseason snap allocation, quarterback rotation,
starter participation, coach intent, current depth/role certainty, and a
chronologically validated total model. It therefore supplies a real shadow
comparison, not an approved betting signal. Cards carry a side/projection for
founder evaluation but have no grade, recommendation-confidence score, stake,
or official tracking eligibility.

## Tracking boundary

- `preseason` always returns `trackingEligible=false`, even if a future model is
  approved and a prediction is locked.
- The existing NFL official market registry remains empty during this shadow
  phase.
- At a later deliberate regular-season launch, only approved, published, locked
  regular/postseason predictions may enter official grading.
- Those eligible settled rows append to the existing NFL lifetime baseline;
  they do not replace or reset the historical record.

## Runtime and failure boundaries

- Provider reads occur once per cached weekly bundle, never per card or user.
- The local page cache revalidates at five minutes.
- Games and current odds are bulk requests with hard pagination and timeout
  limits. Injury collection is slate-level and paginated with its existing cap.
- Missing API credentials, schedule identity mismatch, missing current paired
  markets, history checksum mismatch, insufficient team history, or projection
  count mismatch renders one visible unavailable state. There is no sample slate.
- The page remains unavailable in production and calls `notFound()`.

## Verification contract

- `npm run test:football-product-preview`
- `npm run test:football-shadow-foundation`
- `npm run test:football-model-research`
- `npm run test:football-weekly-slate`
- `npm run verify:model-change`
- TypeScript, focused ESLint, and desktop browser verification of the August 20
  slate, reader interaction, ET day grouping, evidence provenance, and console.
