# NFL player props Receptions role-survival predeclaration

Date: 2026-10-15
Status: frozen before execution; research only

## Why this test

The release-pure loss ledger identifies role survival, player share, and pregame matchup as the
repeatable Receptions separators. The released head models team targets, active-roster target share,
and catch conversion, while the rejected completion-allocation challenger only moves the team
constraint from targets to completions. Neither explicitly distinguishes merely participating from
surviving in a target-earning role.

## Candidate

The challenger remains independent of prop lines, prices, books, consensus, and movement. It
predicts one team target budget, then estimates for every `RB`/`FB`/`WR`/`TE` on the complete
pregame roster:

- the probability of retaining a target-earning role;
- target share conditional on retaining that role; and
- catch rate conditional on receiving targets.

The product of target-role probability and conditional target share is normalized across the full
team receiving roster. That reconciled share is multiplied by predicted team targets and an
exposure-weighted catch rate. Inputs are strictly shifted role, targets, receptions, snaps, depth,
timestamped availability and vacated opportunity, opponent/position allowance, pressure, weather,
PFR/FTN receiving context, and Next Gen Stats separation/cushion/YAC context. Historical test-row
participation is not injected into the roster calculation, and posted-line identity does not force
the target-role probability.

Two finite role definitions are frozen: at least one target and at least two targets. Each component
is blended 25%, 50%, or 75% with the exact released independent Receptions point head, for six total
identities.

## Chronology and gates

- Train only on seasons strictly before the evaluated season.
- Select on 2024 by strict improvement in both MAE and RMSE.
- Confirm the frozen winner on 2025 with non-worse MAE/RMSE, bias no more than 0.25 receptions worse,
  a below-zero game-clustered MAE interval, and no adverse fixed chronological segment.
- Only a confirmed identity may open the exact immutable 2026 offered replay. MAE and RMSE must
  improve and offered-line direction may not decline.

Passing these gates opens separate production parity and balanced board-impact review; it does not
authorize a release by itself. Failure has zero board impact and all stored locks remain immutable.
