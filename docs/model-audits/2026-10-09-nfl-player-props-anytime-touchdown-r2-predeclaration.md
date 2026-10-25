# NFL player props Anytime Touchdown independent-model r2 predeclaration

Date: 2026-10-09

## Disclosed evidence status

The r1 aggregate 2025 and 2026 metrics are already known. R2 is therefore a bounded diagnostic
repair, not a pristine new holdout. No player-level miss, player-level outcome, or teammate pair was
opened to form this hypothesis. Model fitting and calibration remain strictly chronological, the
candidate definitions below are frozen before scoring, and the complete known periods must improve
rather than merely fitting one week.

## Frozen hypothesis

R1 proved that a market-free Poisson team touchdown budget improves probability quality and
calibration, while the role-expanded player head loses too many marginal within-team scorer ranks.
The repair is to retain the released-shape market-free player head for within-team allocation and
use the successful football-only team budget for team strength.

## Frozen candidates

1. `market_free_incumbent_team_budget`: the released-shape HGB without
   `team_implied_touchdowns`; convert its player probabilities to Poisson intensities, normalize
   those intensities within each team, allocate the frozen football-only team TD budget, and convert
   back with `P(anytime TD) = 1 - exp(-lambda)`.
2. `market_free_incumbent_direct_hierarchy_50`: a fixed 50/50 probability blend of the same
   market-free direct head and candidate 1.

No new feature, tree setting, calibration family, team model, scorer-count family, or hyperparameter
is allowed. Model shape is still selected on 2023, Platt versus beta calibration on 2024, and scorer
policy on 2024. The original r1 candidates remain comparators only.

## Acceptance

R2 inherits every r1 gate. In addition:

- It must retain the r1 hierarchy's 2026 Brier and log-loss improvement versus released.
- Its 2025 Brier and log loss must improve versus the market-free incumbent, with no worse
  expected-scorer absolute error.
- Its chronologically selected scorer policy must be within 0.5 percentage point of released 2026
  F1 and improve 2025 F1 versus the market-free incumbent. Report all fixed policies; do not select
  the best 2026 policy after seeing 2026.
- The selected candidate must improve or tie released 2026 AUC in QB, RB/FB, WR, and TE, and may
  not regress both Brier and log loss for any group with at least 100 rows.
- A shippable release remains 100% independent probability. Market price, sharp reference, and
  movement stay downstream and cannot repair a failed model gate.

If both r2 candidates fail, the evidence identifies a genuinely missing within-team opportunity
input rather than authorizing further same-sample candidate search. The smallest next dependency
would be a production-current, as-of-game red-zone/goal-line opportunity feed with a new forward
validation week.
