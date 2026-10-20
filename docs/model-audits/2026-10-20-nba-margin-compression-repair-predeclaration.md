# NBA independent-margin compression repair predeclaration

Date: 2026-10-20

Status: research only. This document authorizes no production score, pick,
probability, grade, stake, reader, writer, lock, or release change.

## Question

Can the independent NBA scorer remove measurable margin compression without
trading away its existing winner, team-score, or Total accuracy?

The incumbent's 2025 predicted-margin standard deviation is 6.879 points while
its calibration slope is 1.117. That combination is consistent with regression
toward the mean. The experiment must distinguish a genuine accuracy repair from
cosmetic widening.

## Frozen candidate families

All candidates use only the existing leakage-safe point-in-time feature file.
Market lines, prices, splits, and outcomes from the evaluation game are not
model inputs.

- Ridge penalties: 10, 30, 100, 300, 1,000, and 3,000.
- Adjusted rating contribution to margin: 0%, 15%, or 30%.
- Adjusted rating contribution to Total: 0% or 20%.
- Train-only margin calibration strength: 0%, 50%, or 100%.

The margin calibrator is a zero-intercept slope estimated only from nested
rolling-origin predictions inside the training partition. Because the feature
file begins in 2021, the 2022 origin has no earlier complete season: for that
origin only, calibration uses a chronological 60% train / 40% evaluation split
inside 2021. Later origins use complete prior-season out-of-fold predictions.
The slope is clipped to 0.85-1.25 before the frozen strength is applied. A
positive slope multiplier preserves the underlying winner direction. Rating
contributions remain matchup-specific and may change direction.

## Chronology

- Candidate selection: rolling evaluation seasons 2022, 2023, and 2024.
- Confirmation: 2025, evaluated only after one recipe is selected.
- Incumbent: ratings/schedule margin-plus-Total ridge with alpha 1,000.
- Season averages and the calibrator are always learned from earlier seasons;
  no pooled future baseline is permitted.

## Selection gates

A recipe is eligible only if, versus the incumbent across rolling origins:

1. mean margin MAE improves;
2. margin MAE improves in at least two of three origins;
3. mean absolute calibration-slope error improves;
4. mean winner accuracy is no worse by more than 0.25 percentage points;
5. mean winner Brier score is no worse by more than 0.001;
6. mean team-score MAE is no worse by more than 0.02 points; and
7. mean Total MAE is no worse by more than 0.02 points.

Eligible recipes are ranked by a frozen joint relative score across margin MAE,
team-score MAE, Total MAE, winner Brier, and calibration-slope error.

## Confirmation gates

Promotion remains unauthorized unless the selected recipe:

- improves 2025 margin MAE by at least 0.10 points;
- improves 2025 team-score MAE;
- keeps Total MAE within 0.01 points of the incumbent;
- does not reduce winner accuracy;
- does not worsen winner Brier score;
- reduces absolute calibration-slope error by at least 20%;
- moves predicted-margin dispersion closer to actual dispersion;
- does not reduce winner accuracy on the incumbent's fixed under-three-point
  game cohort; and
- does not reduce direction accuracy against available opening Spreads.

The candidate-defined close-game cohort is reported only as a diagnostic; it
cannot veto an otherwise valid same-game comparison and cannot authorize a
candidate by itself.

## Safety

The audit is file-read/file-write only. It writes one explicit JSON report,
performs no provider or database calls, and has zero production authority.
Locked and unlocked member records remain untouched. Any eligible candidate
still requires a separately reviewed runtime artifact, release bump, full
reader-path shadow, board-impact report, model-change verification, protected
pull request, and live post-deploy verification.
