# NFL player props combined-yards strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_combined_yards_chronological_2026_10_16_r2`

Production changes: none

## Coverage verdict

The retained inputs support a complete calendar-ordered replay:

| Season | Rows | Games | Players | Mean feature coverage | 5th percentile | Nonzero-carry rows | Nonzero-target rows |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2024 | 4,184 | 272 | 449 | 87.00% | 73.77% | 1,923 | 3,229 |
| 2025 | 4,148 | 272 | 462 | 87.52% | 73.77% | 1,880 | 3,208 |

Each season contains all 272 games and substantial `QB`, `RB`, `TE`, and `WR` samples. Missing feature values are handled by the predeclared training-only median imputation. Data coverage is not the blocker.

## Calendar-ordered result

Training used 2017-2023. Selection on 2024 again chose `opportunity_efficiency_hgb`, without consulting 2025 in this run. The selected architecture was refit through 2024 and scored on 2025.

| 2025 metric | Independent foundation | Opportunity × efficiency | Change |
|---|---:|---:|---:|
| Mean projection (actual 40.219) | 42.200 | 41.709 | candidate bias +1.490 |
| MAE | 24.0344 | **23.1711** | **-0.8633** |
| RMSE | 32.2913 | **30.6581** | **-1.6333** |
| Average threshold Brier | 0.14851 | **0.14093** | **-0.00758** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 272-game paired bootstrap excluded zero in the improving direction for every primary metric:

- MAE delta: -0.864 yards, 95% interval -1.170 to -0.558;
- RMSE delta: -1.634 yards, 95% interval -2.084 to -1.195; and
- average Brier delta: -0.00761, 95% interval -0.00981 to -0.00540.

All four position segments improved MAE, RMSE, and average Brier. All three pregame-workload segments—using 2024-frozen cut points of 4.058 and 7.241 combined lagged carries plus targets—also improved all three metrics. No segment approached the allowed 2% regression boundary.

The expanding-window 2026 Weeks 2-5 external check remained consistent: MAE 24.5370 to 23.7269, RMSE 32.4960 to 31.0596, average Brier 0.15097 to 0.14218, and five of five threshold wins. Those 2026 results remain repeatedly inspected and are not a holdout.

## Decision and exact blocker

The architecture passes every frozen retrospective accuracy, position, workload, and game-clustered gate. Retain it as the Rushing + Receiving Yards independent research foundation.

It is still not a true untouched confirmation and is not production-authorized. The prior r1 tournament used 2025 for architecture selection and exposed all three candidate results before this r2 declaration. Calendar ordering can be reconstructed; epistemic untouchedness cannot. The exact next blocker is prospective outcomes after this declaration joined to release-pure exact offers and prices. Until that ledger exists, no probability calibration, economic gate, promotion/demotion policy, board-count impact, member exposure, or live release is authorized.
