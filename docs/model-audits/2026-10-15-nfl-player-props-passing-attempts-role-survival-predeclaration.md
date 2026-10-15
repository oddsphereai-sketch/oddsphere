# NFL Player Props Passing Attempts role-survival mixture predeclaration

Date: 2026-10-15
Status: research only; third materially distinct Passing Attempts candidate

## Hypothesis

The factorized opportunity model and the independent score-state qualifier both failed their
current-season point gates. Their shared weakness is treating the quarterback's share of team
attempts as one smooth outcome. A pregame QB1 can instead realize no role, a partial game, or a full
game because of availability, injury, benching, or a planned change. Those states have different
attempt distributions and should be modeled explicitly.

## Frozen architecture

1. Define the pregame QB1 from timestamped depth-chart evidence, never from postgame passing rank.
2. Label historical QB1 team-attempt share as no role (`<5%`), partial role (`5%-80%`), or full role
   (`>=80%`). These cutoffs are frozen before opening the 2026 replay.
3. Fit an expanding-window three-state classifier from lagged player role, depth, injury/practice,
   pressure, opponent, weather, and team context only.
4. Fit separate conditional share regressors for partial and full states. Combine state probability
   and conditional share into an expected QB attempt share, then multiply by a separately predicted
   team-attempt budget.
5. For an exact historically posted prop only, use the existence of the offer as pregame evidence
   that the player is expected to participate: set the no-role probability to zero and renormalize
   partial/full probability. The line, price, side, and later result remain excluded.
6. Compare frozen 25%, 50%, 75%, and 100% mixtures with the released independent point forecast.

## Chronology and gates

Train through 2023, select on 2024, confirm on 2025, then open completed 2026 Weeks 1-5. The primary
current-season denominator is every timestamped pregame depth-chart QB1, including zero and partial
games; postgame lead-passer identity is a secondary diagnostic only. Report the exact 16-row offered
replay separately.

A point candidate advances only if it improves both 2026 QB1 MAE and RMSE, does not worsen offered
direction, has no material week-specific collapse, and its game-clustered MAE interval is supportive.
A probability candidate must additionally beat the released independent distribution on offered
Brier and log loss. Historical confirmation alone cannot override a current-season failure.

## Safety

No sportsbook line, price, spread, total, split, or market movement enters the independent forecast.
Research writes ignored local artifacts only. Production releases, the sole writer and lease,
market reader, member rows, tracking, and all locked payloads remain unchanged.
