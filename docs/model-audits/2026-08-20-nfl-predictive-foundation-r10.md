# NFL predictive-foundation audit — r10

Date: 2026-08-20  
Scope: NFL moneyline, spread, total; local research only  
Production, tracking, grades, stakes, and crons changed: **no**

## Decision

Accept `nfl_market_reference_core_2026_08_20_r1` as the NFL champion forecasting
baseline. Reject the current independent football blend as a replacement. The
market reference is a predictive foundation, not a betting edge and not
authorization for an actionable grade.

Every future football, player-availability, or market-intelligence challenger
must be evaluated as a correction to this reference. A failed challenger falls
back to zero correction; it cannot weaken the reference forecast merely to make
the board look more proprietary or actionable.

## Reproducible evidence

`scripts/operator/build_nfl_market_reference.py` generated
`football-research/reports/nfl_market_reference_foundation_2026_08_20_r1.json`
from checksum-pinned inputs.

| Evaluation | Rows | Market/reference | Prior-only baseline |
|---|---:|---:|---:|
| Terminal margin MAE, 2019–2025 | 1,871 | **9.825** | 11.107 |
| Terminal total MAE, 2019–2025 | 1,871 | **10.358** | 10.983 |
| DraftKings opening margin MAE, 2021–2025 | 1,358 | **9.777** | 11.003 |
| DraftKings opening total MAE, 2021–2025 | 1,357 | **10.317** | 10.887 |

Terminal moneyline Brier was 0.21071 with 0.02547 ECE; opening moneyline Brier
was 0.21291 with 0.02705 ECE. Spread and total side probabilities stayed near
the expected 0.25 Brier because the lines are designed to balance the two
sides. The point forecasts prove the spread and total lines are informative;
their near-coin-flip cover probabilities are not evidence that the point lines
are weak.

The frozen r2 challenger failed its original 2025 holdout comparison:

- Margin MAE 9.757 versus 9.722 market-only.
- Total MAE 10.451 versus 10.393 market-only.
- Moneyline, spread, and total Brier all worsened versus the market.

## Genuine opening coverage

The bounded BALLDONTLIE cache now contains provider-native regular-season
openings for 2021–2025. A consistent DraftKings lane supplies 1,358 joined
games. The only game-level gaps are:

- 2022 BUF–CIN, which was canceled and is correctly absent from outcome
  evaluation.
- 2024 DEN–LAC, for which BALLDONTLIE returned no opening row.

No opener was synthesized. The cache records provider, price, line, and
`openedAt`; the member-facing reader continues to make zero provider calls.

## Rejected bridges

The following candidates were tested chronologically and rejected:

1. **Static-feature opening-to-close forecasts.** Ridge, histogram-gradient,
   and boosted-tree movement models all lost to the no-movement baseline in
   future seasons. Observed movement remains evidence; guessed movement does
   not become a model input.
2. **Large model-versus-market disagreement.** The largest 2025 disagreements
   did not correct market error. Raising the edge threshold cannot rescue the
   current independent projection.
3. **Direct market-residual correction.** Strongly regularized ridge
   corrections produced only tiny, unstable totals improvements and no durable
   margin or moneyline improvement.
4. **Dynamic ATS/total residual ratings.** Recent market outperformance was
   predominantly noise and worsened most future-season point forecasts.
5. **Opening-specific independent blends.** The DraftKings opener remained the
   best 2025 margin projection. The best totals improvement was approximately
   0.008 MAE points, far below a promotable effect.
6. **Snap-weighted injury prototype.** Weighting report status by prior snap
   role produced a small totals signal but failed the multi-season stability
   gate. This feature family remains worth rebuilding with strict timestamping,
   but it is not promoted from the prototype.
7. **Historical public/sharp splits.** Playbook returned zero NFL rows for a
   2025 history probe. SharpAPI history requires an Enterprise tier. No split
   history was fabricated or inferred from current percentages.

## Build architecture

The working NFL program is now explicitly three layers:

1. **Reference forecast:** current coherent two-sided no-vig prices, spread,
   and total. This is the accepted predictive core.
2. **Football challenger:** prior-only team efficiency, quarterback value,
   snap-weighted availability, roster/position-group continuity, coaching,
   rest, travel, and weather. It predicts a correction to the reference, never
   an unconstrained replacement.
3. **Sharp decision layer:** actual opening-to-current movement, fixed-line
   price movement, cross-book agreement, tickets/money, source quality,
   availability certainty, and exact offered-price EV. It ranks a weekly
   portfolio only after each signal earns influence in chronological tests.

This separation prevents three recurring errors: calling market agreement a
betting edge, allowing a weak football model to degrade a strong forecast, and
relaxing grade labels to manufacture weekly action.

## Promotion gate

A challenger must:

- Improve pooled Brier/log loss and point MAE in expanding-window folds.
- Improve at least four of six historical selection seasons without one
  material losing season.
- Preserve or improve calibration in the locked future season.
- Produce positive same-book CLV and non-negative locked-price value for the
  weekly portfolio.
- Report promotions, demotions, net actionable count, and market mix.
- Freeze before 2026 Regular-Season Week 1; preseason is never settled or
  appended to lifetime results.

The reference release passes the forecasting-foundation gate. No challenger
currently passes the betting-edge or actionable-grade gate.
