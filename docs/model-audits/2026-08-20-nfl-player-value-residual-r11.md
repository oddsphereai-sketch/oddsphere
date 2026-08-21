# NFL player-value residual audit — r11

Date: 2026-08-20  
Scope: NFL regular-season moneyline, spread, and total; local shadow research only  
Production predictions, grades, stakes, tracking, crons, and readers changed: **no**

## Decision

Accept `nfl_market_residual_player_value_shadow_2026_08_20_r2` as a historical
shadow challenger for **total only**. Keep
`nfl_market_reference_core_2026_08_20_r1` unchanged as the moneyline, margin,
spread, and production-reference champion.

This is the first player-value correction to pass the frozen historical
stability gate, but the effect is deliberately small and not yet a proven
betting edge. It cannot issue or alter an actionable grade until it survives
timestamped 2026 forward predictions, same-book closing-line comparison, and
locked-price value evaluation.

## Player-value feature release

`scripts/operator/build_nfl_player_value_features.py` generated the immutable
`nfl_player_value_features_2016_2025_2026_08_20_r3` release from the checksum-
pinned nflverse injuries, weekly rosters, and snap counts already in the local
research cache.

- 2,639 regular-season games from 2016–2025.
- 92 player-value fields covering QB value and continuity, status-weighted
  unavailability, offensive line, skill positions, defensive front, secondary,
  and healthy unit continuity.
- Weekly injury-report coverage was at least 99.4% in every 2021–2025 season.
- Mean prior-role match coverage for listed injured players was 93.4%–96.4%
  across 2021–2025.
- An unmatched listed player receives only a visible 0.05 reserve-level role
  floor; the builder never promotes an unknown player to starter importance.

The leakage boundary is explicit: a player's role uses only offensive or
defensive snap share observed before the target week. The complete target
week's feature rows are frozen before that week's snap counts update any role.
Historical injury designations are final weekly reports, so they are suitable
for near-kick research and are not treated as if they were known at the
provider-native opening timestamp.

## Tournament design

`scripts/operator/tournament_nfl_player_value_residual.py` fits only the error
remaining after the accepted market reference. It never replaces the market
forecast with an unconstrained football projection.

- Expanding-window selection seasons: 2020–2022.
- Untouched-by-selection confirmation seasons: 2023–2024.
- 2025 is disclosed as previously inspected historical confirmation, not a
  clean future holdout.
- Candidate family: strongly regularized ridge corrections across five frozen
  player-value feature sets.
- Correction cap: four points before shrinkage.
- Zero correction remains the automatic fallback for a failed target.

The selected total recipe is the quarterback feature set, ridge alpha 1000,
and 25% correction weight. Its mean absolute adjustment was 0.206 points; only
0.06% of raw corrections reached the four-point cap. The correction is an
incremental nudge, not a second competing total model.

## Results

| 2020–2025 evaluation | Market reference | Player-value total | Improvement |
|---|---:|---:|---:|
| Total MAE | 10.283282 | **10.277193** | +0.006089 |
| Total RMSE | 13.042174 | **13.034146** | +0.008027 |
| Over/Under Brier | 0.249970 | **0.249800** | +0.000170 |
| Over/Under log loss | 0.693086 | **0.692746** | +0.000340 |

The total correction improved MAE in five of six seasons, including both
2023–2024 confirmation seasons and 2025. Its only losing year was 2020, by
0.0011 MAE points, far below the predeclared material-loss boundary of 0.10.

The margin recipe did not pass: pooled margin MAE moved from 9.764396 to
9.764878. Margin therefore falls back to zero correction. A small Brier gain
does not authorize keeping a point forecast that lost its primary gate.

## Release and tracking boundary

- Model: `nfl_market_residual_player_value_shadow_2026_08_20_r2`
- Calibration: `nfl_market_logit_player_value_adjustment_2026_08_20_r2`
- Tournament: `nfl_market_residual_player_value_tournament_2026_08_20_r2`
- Feature release: `nfl_player_value_features_2016_2025_2026_08_20_r3`
- Reference: `nfl_market_reference_core_2026_08_20_r1`
- Promotions: 0
- Demotions: 0
- Net actionable-board change: 0
- Preseason settlement/tracking eligibility: never

The next required proof is a checksum-locked 2026 forward stream containing
the exact scoring timestamp, expected starter/depth chart, injury report,
opening/current/publish/lock prices, and final result. Only the total challenger
runs in that stream; margin, moneyline, and spread stay on the reference while
their next challenger is researched independently.

## Rollback

Remove the isolated player-value builder, tournament, test, audit, and package
commands. No database, production release, reader, grade, stake, or lifetime
tracking state changed.
