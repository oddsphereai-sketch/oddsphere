# NBA player props product candidate predeclaration

Date: 2026-10-21

Base: `b88b0ecae9a89d473f44959c6be3482c28961966`

## Scope

- Sport: NBA.
- Markets: Points, Rebounds, Assists, Threes, Points + Rebounds + Assists,
  Points + Rebounds, Points + Assists, and Rebounds + Assists.
- Model family: the non-live chronological NBA player-props research candidate
  and its target-book-excluded market arbitration.
- Calibration: market-specific private grade candidates. Only Points, Assists,
  and Points + Rebounds + Assists currently have a qualified actionable surface;
  other markets remain forecast-only until they separately qualify.
- Reader: the existing OddSphere Props board and `PlayerPropReaderDialog`
  visual system, with NBA-specific real-value evidence.
- Writer / lock / private settlement: candidate-only work behind a disabled
  runtime gate. The existing NBA Daily Edge writer remains the sole production
  route and `prediction_pipeline:nba` remains the only authorized lease.
- Navigation: no member NBA Props link is enabled by this candidate.
- Public tracking: unchanged and disabled for NBA player props.

## Existing production authority

- NBA Daily Edge model: `nba_v2_independent_first_2026_10_06_r1`.
- NBA Daily Edge market marriage:
  `nba_market_marriage_2026_10_06_r1_independent_first`.
- NBA Daily Edge grade policy:
  `nba_grade_policy_2026_10_06_r1_coherent_exact_price`.
- NBA refresh owner: `/api/cron/nba-daily-refresh`, under
  `prediction_pipeline:nba`.

This work may reuse the route and lease only after every candidate gate passes.
It may not add a second cron, independent timer, member-triggered provider call,
or parallel writer.

## Frozen research evidence

- Dataset:
  `/private/tmp/nba-player-props-research-dataset-2025-exact-prices-r3-full.json`
- Dataset SHA-256:
  `b8e20c78dabed1f461e8eb9e26c85c61316ba801ac94cf776969c45544d93da8`
- Tournament:
  `nba_player_props_model_tournament_2026_10_20_r9_best_angle_noninferiority`
- Exact-price grade research:
  `nba_player_props_exact_price_grade_research_2026_10_20_r8_best_angle_noninferiority`

The private visual fixture is regenerated from the untouched chronological
confirmation rows. It must contain only real player identities, features,
projections, lines, prices, books, and stored opening observations. It is not a
member recommendation, public result, or permission to rewrite any record.

## Product invariants

1. One canonical main line per game/player/market appears on the board.
   Alternate lines remain internal evidence or a reader price ladder.
2. Projection, prediction side, probability, exact price, and grade must agree.
3. Target sportsbook evidence never validates its own decision.
4. Opening/prior/current/lock movement is same-book and same-line only.
5. Missing values are omitted; no statistic, price, movement, player status,
   probability, or grade is fabricated to fill a panel.
6. Member requests read one compact stored snapshot and never call providers.
7. A partial refresh preserves the last coherent published snapshot.
8. Locked rows are immutable. New semantics apply only to future unlocked rows.
9. Public navigation stays disabled until current-slate provider coverage,
   identity, feature, writer, lock, settlement, load, snapshot, and visual gates
   all pass together and the owner approves activation.

## Required candidate proof

- Current-slate source hierarchy and request budget.
- Canonical game/player identity with no ambiguous write.
- Point-in-time feature coverage and injury/availability continuity.
- Release-pure prediction and grade replay with market-specific board counts.
- Genuine desktop and mobile product preview.
- One authoritative route/lease, bounded cadence, snapshot-size and failure-
  continuity tests.
- Immutable lock and private settlement tests.
- Focused tests, TypeScript, lint, `npm run verify:model-change`, production
  build, current-main integration safety, protected PR checks, and post-deploy
  live proof before any public enablement.

