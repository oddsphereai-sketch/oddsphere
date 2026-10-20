# NBA independent ensemble shadow predeclaration

Date: 2026-10-20

Status: predeclared research-only audit. This document authorizes no production
score, pick, probability, grade, stake, reader rule, writer, lock, or release
change.

## Question

Can a small, independently derived possession/efficiency rating contribution
reduce the current model's close-game compression and margin error without
sacrificing its winner, team-score, or Total accuracy?

This is not a market blend. Both components are fit or computed exclusively
from information available before the game. The market reader remains a
separate downstream layer.

## Frozen chronology

- Feature matrix: the existing point-in-time 2021-2025 NBA feature release.
- Rolling selection origins: 2022, 2023, and 2024.
- Confirmation: 2025, opened only after the selection recipe is frozen.
- Incumbent component: `ratings_schedule`, coherent margin-plus-Total ridge,
  alpha 1000.
- Independent rating component: adjusted offense, adjusted defense, league
  offense, pace, and a training-only home advantage.
- Candidate margin rating weights: 0%, 5%, 10%, 15%, 20%, 25%, 30%, 40%.
- Candidate Total rating weights: 0%, 5%, 10%, 15%, 20%.

Each candidate forms one margin and one Total, then reconstructs one home score
and one away score. There is no side-specific post-processing.

## Selection and confirmation gates

The selection recipe minimizes the mean rolling relative score across
team-score MAE, margin MAE, and Total MAE. It is eligible only when:

1. its worst rolling relative joint score is no worse than 1.0025;
2. its mean rolling winner accuracy is no worse than the incumbent by 0.25
   percentage points;
3. its mean rolling winner Brier score is no worse than the incumbent by
   0.001;
4. it improves mean rolling margin MAE; and
5. the chosen recipe is fixed before 2025 is evaluated.

Promotion remains unauthorized unless the frozen recipe also improves 2025
team-score MAE and margin MAE, does not worsen Total MAE by more than 0.01,
does not reduce winner accuracy, does not worsen winner Brier score, and does
not make the under-three-point forecast cohort less accurate.

The audit also reports predicted-margin dispersion, calibration slope, the
share of forecasts inside three points, and close-forecast winner accuracy.
Those diagnostics cannot override the primary outcome gates.

## Safety

The operator is file-read/file-write only and writes its report to an explicit
output path. It performs no provider calls and no database writes. Existing
locked and unlocked NBA records remain untouched. Any promising result would
still require a separately predeclared production candidate, release bump,
current-board promotion/demotion report, full model-change verification, owner
approval, and protected pull request.
