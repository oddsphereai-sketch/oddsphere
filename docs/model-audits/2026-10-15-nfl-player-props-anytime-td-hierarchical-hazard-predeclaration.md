# NFL player props Anytime TD hierarchical hazard predeclaration

Date: 2026-10-15
Status: candidate frozen before execution; Week 5 remains an already-open immutable external check

## Objective

Replace additive TD feature blending with a structural, market-independent scoring process:

1. predict each offense's touchdown intensity;
2. predict player active/role survival;
3. estimate position-specific player scoring intensity from strictly prior football opportunity;
4. normalize eligible-player intensities to the team TD budget as competing risks; and
5. convert player intensity to `P(at least one TD) = 1 - exp(-lambda_player)`.

Sportsbook line, price, consensus, spread, total, movement, and market probability are prohibited
from every model and calibrator.

## Frozen architecture

- Team budget: the existing regularized Poisson histogram-gradient model, using independent team,
  opponent, pace, environment, prior team TD, and prior opponent-TD-allowed features.
- Role survival: a participation classifier multiplied by a conditional offensive-snap-share
  regressor.
- Player intensity: separate regularized Poisson models for `QB`, `RB/FB`, `WR`, and `TE`.
- Opportunity inputs: shifted player scoring base rate; rushing and receiving red-zone opportunities;
  rushing and receiving goal-line/goal-to-go opportunities; carry share; target share; snap share;
  depth, injury/availability, team state, opponent state, and environment.
- Allocation: `role survival × position-model intensity`, normalized across the complete eligible
  team roster so player intensities sum to the predicted team TD intensity.
- Probability: Poisson at-least-one conversion followed by the same preceding-season global Platt
  procedure used by the fixed independent allocation foundation.

No route-run field exists in the checksum-pinned feature manifest. Shifted offensive snap share is
the frozen route/role proxy; the candidate may not invent routes or assignment-level coverage.
Historical PBP is checksum-pinned through 2025. The retained 2026 PBP file is used only with a
strict `source week < predicted week` shift so Week 5 outcomes cannot enter Week 5 features; its
checksum and week coverage must be recorded.

## Chronology and gates

1. Fit through 2023 and select on 2024 against the fixed independent team-budget/allocation
   ensemble.
2. Fit through 2024 and confirm on untouched 2025.
3. Require lower Brier and log loss and no lower AUC in both seasons.
4. Require the 2025 game-clustered Brier-delta 95% interval below zero, every frozen chronological
   segment non-worse, and no material position-level calibration/discrimination collapse.
5. Only after historical gates, report the frozen 45-row Week 5 board. Require non-worse Brier,
   log loss, AUC, and calibration error to call the architecture a release candidate.
6. Report exact-price, no-vig edge, longshot rank economics, and the existing downstream market
   reader separately. They cannot select or refit the independent hierarchy.

Production TD actionability remains disabled regardless of the research result. Locked rows remain
immutable.
