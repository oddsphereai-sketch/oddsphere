# NFL rich-matchup outcome heads r5 predeclaration

Date: 2026-09-25

Tournament: `nfl_rich_matchup_outcome_heads_2026_09_25_r5`

Status: research/shadow only

## Question and boundary

The runtime-parity r4 outcome heads failed because the limited points, plays,
sack, turnover, and red-zone state did not produce stable total direction or
score error. r5 asks whether the full pregame football state is required:
offensive and defensive EPA, pass/rush matchup, early-down passing, success,
explosive rate, pressure, turnovers, red-zone execution, pace, pass tendency,
quarterback efficiency, injuries, continuity, rest, venue, and weather.

No result, team identity, or price enters the independent matchup layer. The
market margin and total enter only as explicit boundaries/calibration anchors.
No live prediction, grade, stake, tracking history, writer, reader, member
copy, label, or layout may change from this replay.

## Frozen design

- Train 2018-2022; select estimator and probability shrinkage on 2023.
- Replay the already-open 2024-2025 development period chronologically.
- Fit separate regularized-logistic and histogram-gradient home-cover and over
  probability heads from orientation-symmetric matchup features.
- Select by combined spread/total Brier score, then direction accuracy,
  calibration, and complexity.
- Translate the selected probabilities through chronological residual scales
  into one coherent margin, total, and home/away score pair.

## Gates

Spread and total must each be at least 50% with both directions represented;
moneyline may not regress; team-score, margin, and total MAE must each improve
over market; probability calibration and exact-price action economics must be
reported; and runtime reproduction must use one bounded slate-level feature
bundle within the existing NFL writer and lease. The opened replay can qualify
only for a frozen 2026 forward shadow, never immediate production promotion.
