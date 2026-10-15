# NFL player props Rushing Yards explosive decomposition predeclaration

Date: 2026-10-15
Status: frozen before execution; research only

## Candidate

The released Rushing Yards head already separates carries from conditional yards per carry and
uses shifted box count, time to line, RYOE, pressure/front, availability, weather, and role inputs.
This challenger addresses the remaining heavy-tail problem explicitly. Public nflverse play by
play is reduced to two exact player-game contributions:

- yards per attempt from rushes shorter than 10 yards; and
- yards per attempt contributed by rushes of 10 or more yards.

Each contribution is modeled separately by role with the existing strictly shifted runner,
offense, actual-opponent, box/RYOE/time-to-line, depth, availability, weather, and front-context
features. Their sum is multiplied by the independently predicted carry opportunity. Kneels and
spikes are excluded. This is not represented as assignment-level OL/DL tracking.

The finite tournament blends this component 25%, 50%, or 75% with the released independent
Rushing Yards head. Selection is on 2024; 2025 requires lower MAE/RMSE, a below-zero
game-clustered MAE interval, and no adverse fixed chronological segment. Only a frozen identity may
open the exact 2026 replay, where MAE/RMSE must improve and offered-line direction may not decline.

Lines, prices, books, consensus, and movement are excluded from the forecast. Passing opens a
separate parity/current-board gate only. Failure has zero live authority and zero board impact.
