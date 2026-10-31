# NBA expected Four Factors r3 predeclaration

Date: 2026-10-29

Status: final offline aggregate Four Factors experiment. No production,
member, writer, database, grade, stake, lock, tracking, reader, board, or
persisted-shadow authority.

## Decision and question

The repaired r2 disagreement-edge formulation is retired. Its season-week
block-bootstrap intervals crossed zero and winner Brier worsened.

External reviewers disagreed on whether aggregate Four Factors should end
immediately. One recommended stopping because the inputs overlap incumbent
ratings; the other found one material semantic gap: r2 measured disagreement
between offense and defense rates, not the expected level of the matchup rate.

This predeclaration permits exactly one final experiment to answer that narrow
question. No alternative transform may be tried after results are known.

## Frozen baseline and evidence

- base commit: `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`;
- artifact:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`;
- point-in-time feature release:
  `nba_point_in_time_features_2026_10_15_r13_season_regime_state`;
- feature ledger SHA-256:
  `1d5b8f861950c83acfc7b4442e221cceb15c31754f41da12721f9a6f03b3449c`;
- baseline and candidate ridge alpha: `1000`;
- selection seasons: 2023 and 2024 only;
- replication season: 2025 outcomes are scored only if every selection gate
  passes;
- market, injury, and player-rotation inputs: none.

## Frozen transform

Use four factors: effective field-goal rate, turnover rate, offensive-rebound
rate, and free-throw rate.

For every team offense rate, opponent allowed/forced rate, and pace:

1. Blend the current 15-game and prior-season values separately.
2. `current_weight = min(min(home_current_games, away_current_games) / 15, 1)`.
3. When both windows exist, use that weighted blend. When only one exists, use
   the available point-in-time value. Otherwise leave the value missing for
   training-fold median imputation.

Expected possessions are the average of blended home and away pace.

For each factor:

- expected home rate is the average of blended home offense and blended away
  opponent allowed/forced;
- expected away rate is the average of blended away offense and blended home
  opponent allowed/forced;
- the scoring sign is positive for eFG, offensive rebounding, and free throws,
  and negative for turnovers;
- each signed expected rate is multiplied by expected possessions;
- margin contribution is signed home contribution minus signed away
  contribution;
- Total contribution is signed home contribution plus signed away
  contribution.

This creates exactly eight continuous columns: four margin contributions and
four Total contributions. Training-fold standardization centers them. Do not
add missing indicators for these columns.

There is one candidate only: baseline plus these eight columns at alpha 1000.
No alternate windows, weights, pace formulas, factor coefficients, subsets,
interactions, nonlinear transforms, penalties, thresholds, or candidate-based
cohorts are permitted.

## Metrics, uncertainty, and gates

Retain every metric, fixed incumbent margin cohort, maturity diagnostic,
chronological fitting rule, rolling-origin residual-scale rule, and gate from
the corrected r2 robustness experiment.

Use a paired season-by-calendar-week block bootstrap with 2,000 draws and seed
20261029. The overall selection gate remains:

- team-score MAE delta at most `-0.10`, upper 95% interval below zero;
- margin and Total MAE point estimates no worse, upper 95% intervals below
  `+0.10`;
- winner Brier and log loss no worse; winner accuracy no worse by more than
  0.5 percentage points;
- actual-on-predicted margin slope closer to 1;
- tail Brier no worse and interval coverage degradation within two points;
- no fixed margin cohort with at least 150 games regresses by more than 0.5
  margin MAE points or two winner-direction percentage points;
- both selection seasons individually improve team-score MAE and keep margin
  and Total MAE deltas below `+0.10`.

## Stop rule and production boundary

If any gate fails, aggregate Four Factors are exhausted for this audit. No
additional aggregate transform is allowed. The next independent-model research
source must be a genuine immutable, timestamp-valid pregame availability and
rotation ledger.

Even a pass is opened development evidence only. It may open 2025 once for
replication, but cannot authorize production without current 2026-27 forward
locked confirmation, a full independent-plus-roster-plus-reader evaluation,
new release identifiers, board-impact and promotion/demotion tests,
locked-record tests, `npm run verify:model-change`, latest-main integration
safety, a protected pull request, and post-deploy verification.
