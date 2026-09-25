# NFL runtime-parity score engine r2 predeclaration

Date: 2026-09-25

Tournament: `nfl_runtime_parity_score_engine_tournament_2026_09_25_r2`

Status: research/shadow only

## Why r2 exists

The frozen r1 weekly joint-score tournament selected only 10% independent
weight. Its independent model used rich historical EPA/success/explosive
features that the current BALLDONTLIE weekly team-state contract cannot
reproduce. On the already-open 2024-2025 period, r1 reached 51.21% spread and
50.09% total direction accuracy, but failed team-score MAE, total MAE, total
Brier, and action-economics gates. It is rejected for production.

r2 tests a different architectural question: can a score engine built only
from fields the weekly runtime can actually maintain produce stable matchup
signal? Because r1 has already opened 2024-2025, those seasons are development
replay for r2, not an untouched promotion holdout. A successful r2 can enter
2026 shadow only; it cannot change live predictions from this replay alone.

## Frozen runtime-parity feature boundary

The independent model may use only pre-week, orientation-symmetric state that
the existing weekly writer can reproduce without a new per-card API path:

- points scored/allowed;
- offensive plays and opponent plays;
- sack rate;
- turnover rate;
- red-zone touchdown rate;
- games of state, Elo, rest, injuries, roster continuity, coaching continuity,
  venue, and weather.

Historical EPA, success rate, explosive rate, pass-over-expected, CPOE, and
other fields absent from the current runtime contract are forbidden. Market
lines, prices, team identity, and results are forbidden from the independent
stage.

## Coherent calibration

The model first predicts independent home and away points. Those imply one
margin and one total. Market calibration is then selected independently for
margin and total from weights 0% through 100% in 10-point steps, after which
home and away points are reconstructed as `(total +/- margin) / 2`. This keeps
one coherent score pair while allowing evidence to determine whether the
market deserves different influence over winner margin and scoring
environment.

Training is 2018-2022 and recipe selection is 2023. The frozen recipe is then
replayed chronologically on 2024 and 2025. Results are reported by year and
pooled. Promotion remains forbidden until the same frozen recipe accumulates
release-stamped 2026 forward outcomes.

## Shadow qualification gates

- independent and calibrated team-score, margin, and total error are reported
  separately;
- pooled calibrated team-score, margin, and total MAE each improve over market;
- ML accuracy does not regress;
- spread and total direction accuracy are each at least 50% with both
  directions represented;
- ML, spread, and total Brier do not regress;
- exact-price action counts, direction mix, ROI, and yearly stability are
  reported, but cannot authorize production from this development replay;
- runtime implementation must reuse the sole NFL writer, current-season state,
  and `prediction_pipeline:nfl` lease with no new member-read provider calls.

Any failure remains research. No grade threshold, side flip, board quota,
member copy, label, layout, stake, tracking rewrite, or writer change is in
scope.
