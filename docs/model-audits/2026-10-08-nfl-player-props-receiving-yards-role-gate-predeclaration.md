# NFL player props Receiving Yards role-gate predeclaration

Date: 2026-10-08  
Status: frozen after the broad Receiving Yards candidate failed, before role-gated historical scoring

## Why a second stage is justified

The first predeclared team-target candidate improved exact-2026 Receiving Yards point accuracy but
failed its direction gate by one of 72 scopes. The frozen scope diagnostic showed a coherent role
split: WR error and direction improved, while RB and TE direction regressed. This is consistent with
the football architecture. A team-wide target and air-yard allocator directly describes WR work;
RB checkdown/screen usage and TE route-versus-block participation require role data that the current
live contract only approximates.

This diagnosis used the exact 2026 replay, so the second stage is explicitly not a pristine current-
season holdout. It is a diagnostic-led repair whose protection comes from a newly frozen narrow rule,
historical chronology, clustered stability, all-segment checks, the complete disclosed 2026 replay,
and a no-write current-board comparison. No claim of untouched 2026 validation is permitted.

## Frozen candidates and gates

The immediately preceding independent Receiving Yards center remains authoritative for RB, FB, and
TE rows. For WR rows only, test exactly three fixed candidates:

- 50% preceding center + 50% team-target direct yards-per-target component;
- 50% preceding center + 50% target-exposure-weighted direct yards-per-target component; and
- 50% preceding center + 50% decomposed catch-probability × yards-per-reception component.

No other position gate, role threshold, weight, feature, correction, or exception may be introduced.
Rank these candidates using 2024 selection and 2025 confirmation only: both MAE and RMSE must improve
in each year; the 2025 game-clustered 95% MAE-delta interval must be below zero; all four chronological
segments must improve or tie; and bias may not materially regress. The first historically ranked
candidate alone faces the disclosed full 2026 Weeks 1-4 gate and must improve MAE and RMSE while
preserving or improving line direction.

If it passes, probability and current-board gates from the original Receiving Yards predeclaration
still apply unchanged. If it fails, no point candidate ships from this stage. Market lines, prices,
consensus, movement, market probabilities, and results remain forbidden model inputs; market reading
stays downstream.
