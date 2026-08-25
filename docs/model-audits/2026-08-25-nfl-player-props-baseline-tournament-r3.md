# NFL player-props chronological baseline tournament r3

Date: 2026-08-25

Status: local shadow handoff; not production or actionable

Starting base: `e7853b1d90c2066044576e2f98d7bba8072cb8b0` (`origin/main`)

## Decision

Accept the seven mean-projection champions and the participation classifier for continued
local shadow scoring. Do not use the distribution probabilities for prices, edge, play grades,
stakes, promotion, or member output. The point models improved on the prior-five exponential
average in the untouched 2025 holdout for every market, with every game-clustered 95% interval
for the MAE delta below zero. Passing-attempt and passing-completion intervals materially
under-covered, so exact-line probability readiness remains explicitly false.

Board impact is zero promotions, zero demotions, and zero net actionable change.

## Scope and immutable releases

- Tournament: `nfl_player_props_baseline_tournament_2026_08_25_r1`
- Shadow mean model: `nfl_player_props_distribution_shadow_2026_08_25_r1`
- Shadow calibration: `nfl_player_props_distribution_calibration_shadow_2026_08_25_r1`
- Evaluation: `nfl_player_props_chronological_evaluation_2026_08_25_r1`
- Historical dataset: `nfl_player_props_historical_features_2016_2025_2026_08_20_r1`
- Rebuilt feature parquet SHA-256: `7465ef92566059425ef3e183da6d93a3c3485e631eb4e833e998366ce8c3bc7f`
- Generated local artifact SHA-256: `6a01bc7aa2106965020ce61b58f59b979ebfaee468abf83e2d02e4fa54ed7b10`
- Mode: `local_shadow_only`; `actionable=false`; `lineProbabilityReady=false`

The work is additive props research only. It does not add a writer, cron, database table,
route, member reader, grade, stake, or tracking mutation. It does not modify the shared NFL
Daily Edge runtime, shared lease, CFB model, or production model-release registry.

## Method

The checksum-verified history contains 138,860 player-game rows from 2016 through 2025.
Training uses seasons through 2022, model selection uses 2023, confirmation/veto uses 2024,
and 2025 is opened once as the holdout. The final local artifact is then refit through 2025.

Features are limited to the historical manifest's pregame feature list plus home status and
position indicators (115 total). Outcome-only and unstamped context columns are blocked.
Per-market role thresholds are based only on prior games. Candidate point models are prior
averages, ridge, histogram gradient boosting, and—on counts—Poisson regression. Selection is
by 2023 MAE; a selected model is vetoed if its 2024 MAE is more than 1% worse than the EWM
baseline. No champion was vetoed.

Uncertainty uses 500 game-cluster bootstrap draws. Count distributions compare Poisson and
negative binomial on pre-holdout out-of-sample residuals; continuous markets use a normal
residual scale. These initial distribution families are diagnostic, not approved calibration.

## Holdout results

| Market | Champion | Rows | Model MAE | EWM MAE | Clustered MAE delta, 95% CI | 90% coverage |
|---|---:|---:|---:|---:|---:|---:|
| Passing attempts | HGB | 671 | 8.956 | 10.693 | -1.756 [-2.198, -1.290] | 75.3% |
| Passing completions | Ridge | 671 | 5.800 | 6.717 | -0.925 [-1.163, -0.657] | 79.1% |
| Passing yards | Ridge | 671 | 68.178 | 77.428 | -9.336 [-12.221, -6.501] | 88.8% |
| Rushing attempts | HGB | 1,942 | 3.278 | 3.521 | -0.243 [-0.309, -0.180] | 89.6% |
| Rushing yards | Ridge | 1,942 | 18.740 | 20.130 | -1.385 [-1.779, -0.989] | 90.9% |
| Receptions | Ridge | 3,594 | 1.522 | 1.638 | -0.115 [-0.135, -0.095] | 95.7% |
| Receiving yards | Ridge | 3,594 | 19.960 | 21.465 | -1.508 [-1.807, -1.221] | 91.7% |

The HGB participation champion also held up on 13,441 2025 rows: Brier 0.09197 versus
0.12122 for prior-average participation, log loss 0.31343, AUC 0.93656, calibration gap
0.00999, and game-clustered Brier delta -0.02930 with 95% CI [-0.03233, -0.02619].

## Readiness holds

The artifact is mean-projection ready only for local shadow experiments. Four explicit health
findings block market-reading and grade work:

- `HISTORICAL_PROP_PRICES_UNAVAILABLE`: no locked/opening/closing prices, so ROI, closing-line
  value, vig removal, and price calibration cannot be evaluated.
- `SPORTSBOOK_OFFER_POPULATION_UNOBSERVED`: the historical rows are not the exact offered prop
  population, so selection bias and board coverage are unknown.
- `CURRENT_WEEK_CONTEXT_UNSTAMPED`: a live inference adapter still needs timestamped roster,
  injury, depth-chart, and availability evidence.
- `COUNT_DISTRIBUTION_INTERVAL_CALIBRATION_INCOMPLETE`: passing attempts and completions
  materially under-cover, while receptions over-cover.

This means the current scorer may return research-only probabilities for plumbing tests, but
they must not become a Sharp API market edge, play grade, lean, best angle, stake, or member
card. The artifact is also local and checksum-pinned rather than committed to the repository.

## Verification and handoff sequence

Focused tests cover chronology, role eligibility, distribution math, clustered uncertainty,
and scorer probability bounds. A 20-row runtime smoke test loaded the generated artifact,
produced all seven projections and research-only over probabilities, and preserved
`actionable=false` and `lineProbabilityReady=false`. That smoke sample validates runtime
shape only; it is not evaluation evidence because the final artifact is refit through 2025.

The next owned props work should remain shadow-only: build a timestamped 2026 inference-feature
adapter; forward-collect the exact sportsbook offer population, lines, prices, and locks;
evaluate empirical/conformal or market-specific residual calibration without reopening the
2025 model-selection decision; then measure probability calibration, CLV, price-adjusted value,
coverage, latency, and bounded slate load. Only after those gates pass should a separate,
versioned proposal integrate market reading and balanced promotion/demotion rules with the
shared NFL grade owner.
