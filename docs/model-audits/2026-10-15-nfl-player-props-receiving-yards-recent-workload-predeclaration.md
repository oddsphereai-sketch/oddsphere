# NFL player props Receiving Yards recent-workload predeclaration

Date: 2026-10-15
Status: frozen before results

## Question

The completed-air/YAC challenger improved Receiving Yards point error narrowly but failed the
probability and actionability gate. Its largest unresolved error is target workload, not another
efficiency transformation. This tournament asks whether an explicit recent team-target budget and
roster-normalized recent target-share allocation improves the released independent Receiving Yards
center.

## Information boundary

The candidate may use only strictly shifted pregame fields:

- team target averages/EWM and opponent allowed-target averages/EWM;
- player target-share averages/EWM/season average;
- current pregame final/practice availability severity;
- the already-fitted market-independent direct yards-per-target component.

Lines, prices, books, consensus, movement, locked outcomes, and current-game statistics are
forbidden model inputs. Missing signals use a fixed league/team fallback; player shares are
normalized within the complete RB/FB/WR/TE roster for that game and team.

## Frozen candidates

Three workload identities are evaluated at 25% and 50% blends with the released independent point:

1. `short`: team targets from recent three-game/EWM offense and opponent allowances; player share
   from recent three-game/EWM target share;
2. `balanced`: the same budget plus five-game/season share stabilization;
3. `availability`: `balanced` with the player's pregame availability severity applied before team
   normalization so vacated opportunity reallocates within the roster.

No identity or coefficient will be added after opening 2024 results.

## Gates

1. Training data ends in 2023.
2. On 2024 selection, both MAE and RMSE must beat the incumbent.
3. Freeze the lowest-weight eligible identity before opening 2025.
4. On 2025 confirmation, both MAE and RMSE must not regress; the game-clustered 95% MAE-delta
   interval must be below zero, and all four chronological week segments must be nonpositive.
5. Only then open the exact immutable 2026 offered scopes. The candidate must not regress MAE,
   RMSE, or direction.
6. A point-gate winner still requires same-input probability, promotion/demotion, and board-count
   evaluation before production. Locked payloads remain unchanged.
