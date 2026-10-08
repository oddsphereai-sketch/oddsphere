# NFL player props independent forecast and market observer — complete-family predeclaration

Date: 2026-10-08  
Starting production base: `0e7e6e056f9b7da64dc3f71920c908f577c7c5c5`

## Scope

This audit covers every currently supported NFL player-prop family: Passing
Attempts, Passing Completions, Passing Yards, Rushing Attempts, Rushing Yards,
Receptions, Receiving Yards, and Anytime Touchdown. It does not authorize a
production change merely because an aggregate result improves.

The independent football forecast and the market observer are separate systems.
Target prop prices, target-book prices, consensus prices, opening prices, and
future movement cannot enter an independent point projection or its independent
probability calibration. Market evidence may later label a forecast unavailable,
neutral, confirming, adverse, or strongly adverse. No market adjustment or side
flip may be promoted without a release-pure chronological result for that exact
market.

Member copy, labels, layout, stakes, canonical one-line selection, locked payloads,
the sole production writer, `prediction_pipeline:nfl`, refresh scheduling, the
3:00 a.m. board boundary, T-60 operational behavior, injury fallback, and odds
fallback remain out of scope unless separately coordinated.

## Frozen questions

### Independent forecast

1. Does the active point head already use the strongest reproducible pregame
   opportunity, role, team-volume, opponent, pressure, explosive-play, air-yard,
   YAC, pace/style, venue, and weather features available for its market?
2. Can a market-specific architecture improve both MAE and RMSE before the final
   holdout? Candidates include opportunity-first team budgets, partial-pooled
   player shares, position/role specialists, coherent conditional-efficiency
   heads, availability-conditioned role transfer, and conservative ensembles.
3. Can price-blind probability calibration improve Brier score and log loss while
   preserving acceptable calibration error and central-interval coverage?
4. Are player-assignment matchup claims reproducible? OL/DL and CB/WR coefficients
   are ineligible unless a timestamped historical source and a live inference path
   exist. Aggregate team matchup proxies must be labeled as aggregate proxies.

### Market observer

1. Which current observations actually come from Pinnacle, Circa, Bookmaker, or
   other source-qualified sharp books by prop market? Code support alone is not
   coverage.
2. Can a same-book opening/current trail be reconstructed without crossing books
   or lines? Both line movement and price movement are required in the retained
   evidence; missing evidence is neutral.
3. On prospectively captured release-pure decisions, do confirming, adverse, and
   strongly adverse states improve direction, Brier score, and log loss versus the
   independent forecast? A flip rule must pass independently; it cannot be inferred
   from a generic market blend.

## Chronology and gates

- Point architecture: train through 2022, select on 2023, confirm on 2024, and open
  2025 only after the candidate and weights are frozen.
- Price-blind calibration: use an earlier chronological fit window, a distinct
  selection window, and a later untouched confirmation window. No target price is
  a calibration feature.
- Market observer: use only timestamped observations available at the decision
  time. Evaluate opening, T-24, T-6, and T-60 separately when present. Historical
  openings without intervening snapshots cannot validate movement.
- Each ordinary market must report sample size, MAE, RMSE, bias, direction at exact
  representative lines, Brier score, log loss, calibration gap, and 80%/90%
  interval coverage where applicable. Anytime Touchdown reports discrimination,
  Brier/log loss, calibration, and within-team scorer ranking.
- A point candidate must improve both selection MAE and RMSE, then preserve both on
  confirmation and holdout. A probability candidate must improve Brier and log
  loss without materially worsening calibration or interval coverage.
- A market-observer adjustment or flip must improve direction, Brier, and log loss
  on untouched evidence for its market. Every actionable demotion must be paired
  with an evaluated promotion rule and board-count impact.
- Any split with fewer than 100 exact non-push decisions remains shadow-only.

## Publication boundary

Research scripts and read-only audits may be committed under this predeclaration.
No production forecast, probability, grade, market selection, writer, or reader
behavior changes unless a market-specific candidate passes the frozen gates, new
release identifiers are assigned, locked precedence is tested, focused tests and
`npm run verify:model-change` pass, and latest-main integration safety succeeds.

