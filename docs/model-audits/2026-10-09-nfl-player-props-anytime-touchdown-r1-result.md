# NFL player props Anytime Touchdown independent-model r1 result

Date: 2026-10-09

## Decision

Do not promote any r1 candidate. The football-only hierarchy materially improves probability
quality, calibration, and ranking AUC, but the frozen displayed-scorer gate narrowly fails. This is
a diagnosed architecture result, not permission to ship a worse selector or to return to bookmaker
anchoring.

## Frozen evaluation

The tournament used 11,189 eligible player-games in 2023 for model-shape selection, 11,120 in
2024 for calibration and policy selection, 11,327 in the 2025 holdout, and 2,522 across the 64
completed 2026 games in Weeks 1-4. Official nflverse play-by-play supplied 252 2026 scorers.
No target touchdown price, consensus probability, line movement, spread, total, or bookmaker team
expectation entered any challenger.

The predeclared 50% direct / 50% team-hierarchy candidate won 2023 selection. The pure team-budget
hierarchy was the strongest 2026 probability model:

| Metric | Released independent | Market-free team hierarchy |
| --- | ---: | ---: |
| 2026 Brier | 0.076566 | 0.075930 |
| 2026 log loss | 0.258502 | 0.251981 |
| 2026 ROC AUC | 0.826334 | 0.836354 |
| Expected scorers | 285.96 | 256.93 |
| Observed scorers | 252 | 252 |
| Calibration gap | 0.017706 | 0.008883 |

The game-clustered challenger-minus-released delta was -0.000637 Brier with 95% interval
[-0.001686, +0.000415], and -0.006521 log loss with interval [-0.010391, -0.002658]. The model
improved Brier in Weeks 1, 3, and 4 and improved the Weeks 2-4 aggregate. By position, it improved
log loss and AUC for QB, RB/FB, WR, and TE; TE Brier alone was slightly worse.

The hierarchy also cleared the 2025 probability comparison against the market-free incumbent:
Brier 0.073248 versus 0.073292, log loss 0.243506 versus 0.244798, and expected-scorer absolute
error 13.93 versus 20.26.

## Failed scorer gate and diagnosis

The released team-rounding policy selected 284 names and found 101 scorers in 2026: 35.56%
precision, 40.08% recall, and 37.69% F1. The hierarchy's historically selected week multiplier
selected 321 and found 104: 32.40% precision, 41.27% recall, and 36.30% F1. Its best predeclared
2026 count variant selected 296 and found 101, producing 36.86% F1. That is 0.83 percentage point
below the released policy and outside the allowed 0.5-point regression.

The failure is not aggregate probability or team scoring volume. The hierarchy is better calibrated
and has higher AUC in every position group. The remaining defect is the within-team allocation:
the role-expanded player head improves cross-team discrimination but misorders enough adjacent
teammates that a better team budget cannot recover the displayed scorer set.

Rejected candidates:

- `market_free_incumbent_hgb`: worse 2026 Brier than released and 36.53% best selected-policy F1.
- `market_free_role_hgb`: improved Brier/log loss but only 35.34% selected-policy F1.
- `market_free_team_budget_role`: best probability quality, but 36.30% selected-policy F1.
- `market_free_direct_hierarchy_50`: won 2023 and improved probability quality, but 36.72% F1.

No production artifact, probability, prediction, grade, action, stake, lock, tracking row, writer,
lease, schedule, provider call, copy, label, or layout changed.

## Bounded redesign

The r2 predeclaration freezes the direct repair before testing it: keep the released-shape player
head's within-team role ordering, remove its bookmaker feature, and allocate its Poisson intensity
through the already successful football-only team touchdown budget. This directly targets the
observed allocation failure without changing the team model, adding a manual scorer quota, or
looking at individual 2026 misses.
