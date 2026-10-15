# NFL player props Receiving Yards air/YAC decomposition result

Date: 2026-10-15
Decision: reject; not production-authorized

## Result

The independently fitted completed-air/YAC architecture passed the predeclared point gates, then
failed the same-input locked-action decision audit. The
frozen identity is `all_air_yac_blend_25`: 75% of the incumbent independent point plus 25% of

`predicted targets × completed-air-yards per target`

`+ predicted targets × catch rate × YAC per reception`.

The component uses 100% matched public weekly outcomes and 261 strictly shifted role, team,
actual-opponent, depth, availability, pressure, intended-air-yard, separation/cushion, expected-YAC,
weather, and position features. Lines, prices, books, consensus, and movement are absent.

| Window | Incumbent MAE / RMSE | Candidate MAE / RMSE | Direction |
| --- | ---: | ---: | ---: |
| 2024 selection, 3,538 rows | 19.79645 / 27.29791 | **19.65862 / 27.24010** | not opened |
| 2025 confirmation, 3,492 rows | 19.32055 / 26.58654 | **19.15502 / 26.55398** | not opened |
| exact locked 2026 offered scopes, 72 rows | 34.33198 / 52.42191 | **34.03937 / 52.24816** | 48.61% → 48.61% |

The 2025 game-clustered candidate-minus-incumbent MAE interval is
`[-0.21441, -0.11437]`, and all four frozen chronological segments improve. On current rows the
mean MAE delta is `-0.29261`, but the 23-game clustered interval is `[-1.09292, +0.50414]`; the
small current sample therefore does not establish a robust win.

Role diagnostics show the largest current improvement at tight end (`29.09049` → `28.19780` MAE).
Running back improves narrowly. Wide receiver MAE improves narrowly while WR RMSE regresses, so the
result is not authority to fit a role-specific 2026 adjustment.

## Same-input decision audit

The candidate and control were passed through the current Receiving Yards residual distribution,
market-residual weight, and grade thresholds on the exact same 72 immutable lines, prices, stored
market probabilities, movements, and participation inputs.

| Measure | Control | Candidate |
| --- | ---: | ---: |
| Brier | **0.25107** | 0.25169 |
| Log loss | **0.69527** | 0.69651 |
| Forecast direction | 51.39% | 51.39% |
| Actionable retained rows | **62** | 51 |
| Best Angle / Lean | **12 / 50** | 12 / 39 |

All 72 projections changed, but zero forecast sides changed. Fourteen grades changed, including
11 actionable demotions and zero promotions within the retained locked-action set. The replay does
not retain the full unlocked historical board, so it cannot honestly estimate new-row promotions
or claim a whole-board count. This limitation does not rescue the candidate: probability quality
worsened on the scopes that are observable, while actionability fell materially.

## Boundary

The exact point replay evaluates the immutable stored independent projection first, as required;
it does not replace or reinterpret that locked field with newer semantics. The decision audit is a
separate counterfactual with the current calibration applied equally to both arms. The candidate
has zero live weight, zero board impact, and no production release identifier.
