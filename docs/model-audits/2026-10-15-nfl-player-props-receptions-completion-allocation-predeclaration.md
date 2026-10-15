# NFL player props Receptions completion-allocation predeclaration

Date: 2026-10-15
Status: frozen before execution; research only

## Candidate

The released Receptions head forecasts team targets, allocates targets across the active roster,
and then estimates catch conversion. This challenger asks whether the full-game constraint is more
accurately expressed one level later:

`predicted team completions × roster-normalized player reception share`.

The team-completion budget is fitted from shifted pass volume, completion context, quarterback,
pressure/sack, opponent, score-state tendency, weather, and roof inputs. Player reception share is
fitted across the complete `BACK`/`WR`/`TE` roster with shifted targets, receptions, target and
air-yard shares, snap/depth, current timestamped availability and vacated workload, catch quality,
separation/cushion, expected YAC, and position/opponent context. Posted-player identity may provide
pregame participation evidence; line, price, side, book, movement, and outcome are prohibited.

The finite candidates are 25%, 50%, and 75% blends of the completion-allocation component with the
released independent Receptions head. Selection is on 2024; the identity is frozen and must improve
both MAE and RMSE on 2025 with a below-zero game-clustered MAE interval and no adverse fixed
chronological segment. The exact 2026 offered replay through Week 5 is opened only after historical
confirmation and must improve MAE/RMSE without reducing offered-line direction.

Passing opens parity/current-board evaluation, not production. Failure retains the incumbent with
zero board impact. Stored locked projections and decisions remain unchanged and retain precedence.
