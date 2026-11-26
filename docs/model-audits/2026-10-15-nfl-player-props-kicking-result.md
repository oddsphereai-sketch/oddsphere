# NFL player props: field goals made and kicking points result

Date: 2026-10-15

Verdict: adopt the decomposed kicking architecture as the independent research foundation for Field Goals Made and Kicking Points; do not add either market to the live product until exact offers/prices are captured and a versioned product path is approved.

## Architecture selected before 2026 scoring

The 2025 selection chose a Poisson tree for Field Goals Made and a regularized Poisson GLM for PATs Made. Kicking Points uses the component means as `3 × expected field goals + expected PATs` and obtains threshold probabilities by convolving the two Poisson distributions.

The 44 pregame, non-market features separate:

- team and opponent field-goal/PAT attempt opportunity;
- drives, trips inside the opponent 35, red-zone drives, touchdowns, and recent field-goal decisions;
- kicker short/long field-goal and PAT conversion skill with partial pooling;
- offensive volume and opponent concession context;
- home, roof, wind, and temperature.

## 2026 Weeks 2-5

### Field Goals Made

| 126 kicker-games | Opportunity × conversion foundation | Selected model |
|---|---:|---:|
| MAE | 1.1390 | **1.0572** |
| RMSE | 1.3824 | **1.2538** |
| Mean Poisson deviance | 1.2658 | **1.0222** |
| Mean Poisson log score | 1.7268 | **1.6050** |
| Average threshold Brier | 0.18850 | **0.16771** |

The selected model improved Brier score at all four thresholds (over 0.5, 1.5, 2.5, and 3.5 made field goals).

### Kicking Points

| 126 kicker-games | Component foundation | Selected components |
|---|---:|---:|
| MAE | 3.2926 | **3.0425** |
| RMSE | 3.9602 | **3.6234** |
| Average threshold Brier | 0.24803 | **0.22648** |

The selected component model improved Brier score at every tested line from 4.5 through 9.5 kicking points.

## Uncertainty

A 2,000-draw paired bootstrap over 63 games strongly favored the selected architecture.

| Candidate-minus-foundation delta | Mean | 95% interval | Probability candidate improves |
|---|---:|---:|---:|
| Field-goal MAE | -0.0827 | [-0.1626, +0.0011] | 97.3% |
| Field-goal deviance | -0.2432 | [-0.4361, -0.0664] | 99.6% |
| Field-goal average Brier | -0.02082 | [-0.03575, -0.00637] | 99.7% |
| Kicking-points MAE | -0.2510 | [-0.4966, -0.0118] | 98.0% |
| Kicking-points RMSE | -0.3380 | [-0.6121, -0.0664] | 99.3% |
| Kicking-points average Brier | -0.02152 | [-0.04240, -0.00200] | 98.7% |

Only the field-goal MAE interval barely crosses zero. The distributional and kicking-points evidence is materially stronger than the Passing TD or Interceptions results.

## OddSphere archived-game slice

The selected components also improved the four kickers from the two Week 5 games:

| Metric | Foundation | Selected |
|---|---:|---:|
| Field-goal MAE | 1.4359 | **1.2298** |
| Field-goal deviance | 1.6256 | **1.3802** |
| Field-goal average Brier | 0.20959 | **0.17898** |
| Kicking-points MAE | 4.0636 | **3.3841** |
| Kicking-points RMSE | 4.2646 | **3.5738** |
| Kicking-points average Brier | 0.33301 | **0.28238** |

The sample is only Tyler Bass, Harrison Mevis, Brandon Aubrey, and Chase McLaughlin. It supports rather than establishes the result.

## External research alignment

nfl4th's official open-source documentation models field-goal make probability from distance and roof type, supporting the separation of attempt opportunity from conversion and the inclusion of environment rather than a single recent-makes average. [nfl4th documentation](https://github.com/nflverse/nfl4th)

nflfastR's expected-points work models next-score type—including field goals—from field position, down/distance, clock, score, roof, and team state, and validates with held-out seasons. That supports the drive/field-position opportunity component and the chronology used here. [nflfastR model documentation](https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd)

The nflfastR model-data construction explicitly treats field goals as a distinct next-score event, rather than folding them into generic scoring. [nflverse model-data source](https://github.com/nflverse/nflverse-pbp/blob/master/models/model_data.R)

## Product decision and remaining risk

This is a genuine independent-model improvement and should be the starting point when OddSphere adds kicking markets. It is not live because:

1. no release-pure Field Goals Made or Kicking Points offers/prices exist in the Week 5 archive or observer;
2. economic value and market-reader behavior cannot be evaluated;
3. the compound kicking-points distribution assumes independent FG/PAT counts even though both share team scoring opportunity;
4. a production addition requires new versioned outcome, calibration, decision, writer, lock, and reader contracts.

The next concrete product-data step is to retain exact kicking offers prospectively. The next independent-model family should be Longest Rush, which is not blocked by receiver-route entitlements.

No production model, calibration, decision, grade, stake, writer, reader, or public page changed.
