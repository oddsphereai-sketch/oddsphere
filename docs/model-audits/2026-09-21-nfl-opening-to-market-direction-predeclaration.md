# NFL opening-to-market direction audit predeclaration

Date: 2026-09-21

Status: frozen before inspecting any 2021-2025 outcome produced by this audit.

## Objective

Test one simple, deployable market-reading rule for every NFL Spread and Total forecast. The rule must choose a side for every healthy game; it may not suppress predictions, flatten the board, change copy, or manufacture split evidence.

## Immutable inputs

- Completed 2021-2025 regular-season schedules and provider-native opening prices from the repository's bounded BALLDONTLIE cache collector.
- The frozen `nfl_pregame_features_2016_2025_r1` artifact for terminal NFL market lines, prices, and final scores.
- DraftKings is the fixed opening-book family because it is present in the historical cache and gives one reproducible provider-native opening per game.
- Terminal nflverse line and two-sided price are the later-market observation. They are an evaluation proxy for the current production T-60 multi-book median, not an assertion that the timestamps are identical.

No result, score, closing-line movement after the evaluated later quote, public split, injury, or model output may enter the directional rule.

## Frozen rule

For Spread, convert the terminal home margin to a home spread line. If the later home spread is at least 0.5 points lower than its DraftKings opening, predict the home side. If it is at least 0.5 points higher, predict the away side. Otherwise, choose the side with at least 50% later-market no-vig probability.

For Total, if the later total is at least 0.5 points above its DraftKings opening, predict Over. If it is at least 0.5 points below, predict Under. Otherwise, choose the side with at least 50% later-market no-vig probability.

Pushes are excluded only from resolved accuracy and ROI denominators. Every non-push healthy game receives a prediction.

## Chronological protocol

- Selection: 2021-2023.
- Confirmation, opened once after the rule and gates are committed: 2024-2025.
- The operator must stop after selection unless `NFL_OPEN_CONFIRMATION=1` is explicitly set.
- Results are reported pooled, by season, by market, and by movement-versus-flat-price reason.

## Gates

A market may proceed beyond audit only if all are true:

1. Selection pooled resolved accuracy is at least 52% and every selection season is at least 50%.
2. Confirmation pooled resolved accuracy is at least 50% and each confirmation season is at least 50%.
3. The confirmation market has both directions represented.
4. The complete-board rule does not reduce the number of predictions.
5. Exact-price economics, projected-score coherence, release identities, writer ownership, and board impact are separately verified before any production change.

Passing this audit is necessary but not sufficient for launch. A failed gate rejects the rule without changing production.

