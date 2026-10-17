# NFL player props: touchdown count and first touchdown predeclaration

Date: 2026-10-15

Mode: read-only independent-model research; zero production writes

## Hypothesis and architecture

Player Touchdowns and First Touchdown should share one coherent independent scoring-hazard foundation rather than separate arbitrary classifiers. Predict each eligible skill player's touchdown count intensity from pregame carry/target role, red-zone opportunity history, team touchdown budget, opponent allowance, position, depth/injury state, and available efficiency/matchup context. Sportsbook inputs are excluded.

- Player Touchdowns uses the resulting count intensity directly with a Poisson count distribution.
- First Touchdown normalizes player intensities within the full game and preserves residual probability for no offensive eligible player scoring the game's first touchdown. It is evaluated against the first chronological touchdown event, including games whose first touchdown is defensive or special teams.

## Chronology, candidates, and gates

Fit 2017-2024, select once on 2025, refit through 2025, and test once on 2026 Weeks 2-5. Foundation is a shrunk player share of lagged team scoring. Candidate A is a regularized Poisson GLM; Candidate B is a shallow Poisson histogram gradient booster. The 2025 count winner is frozen for both coherent outputs.

Touchdown-count advancement requires lower 2026 MAE, Poisson deviance, average Brier, and at least three of four fixed thresholds (0.5, 1.5, 2.5, 3.5). First-TD advancement requires lower 2026 Brier and log loss than the foundation. Results must disclose the number of games and positive first scorers.

No production promotion is allowed without release-pure offers/prices, calibration, and board-impact evidence. First-TD actionability also remains dependent on proving complete eligible-player offer coverage.

