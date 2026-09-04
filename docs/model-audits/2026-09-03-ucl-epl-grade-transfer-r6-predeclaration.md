# UCL EPL-grade transfer r6 predeclaration

Date: 2026-09-03
Owner authorization: Daniel Mengel explicitly directed that Champions League
play grades launch from the established Premier League foundation rather than
remain universally withheld while a new UCL price calibration is accumulated.

## Frozen scope

- Competition: UEFA Champions League only.
- Forecast authority: unchanged
  `ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest` PMF,
  projections, probabilities, and forecast sides.
- Grade authority: a new UCL-owned, version-pinned fork of EPL v23. Runtime
  must not import or call the mutable EPL grade implementation.
- Writer/runtime: unchanged shared soccer writer under the sole
  `prediction_pipeline:soccer` lease. No new provider request, cron, writer,
  database table, stake, or member layout.
- Evaluated cohort: the already-published 18-game / 72-market UCL Matchweek 1
  board generated on 2026-09-03. Compare the r5 all-No-Play release with the
  proposed r6 policy on the identical model and exact current-price tuples.
- Required report: exact price coverage and before/after Best Angle, Lean,
  Watchlist, Caution, No Play, held, promotion, demotion, side-change, and
  nonpositive-EV actionable counts, split by market.

## Frozen transfer rules

The rules below deliberately preserve the EPL v23 hierarchy while stamping a
new UCL calibration release. They are a provisional transfer policy, not a
claim of UCL-specific historical price validation.

- Missing, incomplete, or incoherent current price evidence is an operational
  No Play and cannot be counted as an evaluated grade.
- Match Result remains the regulation-time model argmax. Price may grade that
  forecast but may never replace it with a less-likely outcome.
- Match Result Best Angle requires the forecast side to be the strongest
  de-vigged value side, at least 5 percentage points of edge, price above -300,
  positive exact-price EV, and no sparse-club prior.
- Match Result Lean requires either (a) at least 50% forecast probability,
  agreement with the market favorite, price above -300, positive exact-price
  EV, and no sparse-club prior; or (b) the EPL short-price high-confidence path
  (at least 65% with full club evidence or 70% with a sparse-club prior), market
  agreement, and positive exact-price EV.
- Total and BTTS Lean require at least 55% forecast probability and positive
  exact-price EV. The 53% monitoring band and nonpositive-EV qualifying rows
  remain Watchlist. These rules grade the UCL PMF's side, not a market-created
  side.
- Double Chance remains monitoring-only: at least 72% forecast probability and
  nonnegative edge may be Watchlist; no actionable transfer threshold exists.
- A greater-than-20-point model/market disagreement is Caution or data hold.
  A sparse-club prior caps ordinary edge promotions at Watchlist.
- No quota, favorite/underdog/draw balance, contrarian selection, or stake is
  permitted. Every Best Angle or Lean must arise naturally from its own tuple.

## Evidence boundary and rollback

The UCL chronological forecast replay remains the model-quality evidence. The
calibration cohort still lacks historical exact prices, so r6 will be labeled
as an owner-approved EPL transfer policy and evaluated forward by its exact
release and T-60 lock. It must not be described as independently UCL-validated.
Rollback restores r5 for future unlocked rows while preserving every r6 lock
and tracked row unchanged. Any nonpositive-EV actionable, side substitution,
mixed release, incomplete four-market lock, or unexpected board collapse is a
release blocker or rollback trigger.
