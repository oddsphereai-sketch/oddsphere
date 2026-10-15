# NFL Player Props Passing Yards receiver-aggregation predeclaration

Date: 2026-10-15
Status: research only; Passing Yards current-season continuation

## Hypothesis

The current Passing Yards point head already estimates yards per completion from quarterback and
defensive context, but its 2026 offered misses are dominated by pass-volume error. A materially
different bottom-up forecast can also expose receiver-room and position-matchup information that is
otherwise compressed at the quarterback level: forecast each eligible RB/FB/WR/TE's target share
and yards per target, sum the receiving room, then allocate the total to the expected quarterback
using only his independent share of team pass attempts.

This directly incorporates shifted receiver depth, availability, target share, catch/air-yard/YAC
skill, and opponent position allowance. It does not infer unavailable route-level WR/CB assignments.

## Frozen architecture

1. Forecast market-free team target budgets by BACK, WR, and TE role group.
2. Allocate each group budget across the timestamped pregame roster using shifted participation and
   target-share evidence.
3. Estimate each player's yards per target from shifted PFR, FTN, NGS, team/opponent, pressure,
   weather, depth, and injury evidence.
4. Sum player receiving-yard expectations to a team receiving total.
5. Allocate that total to the evaluated quarterback with his separately predicted share of team
   passing attempts; cap the share to `[0.50, 1.00]`.
6. Compare 25%, 50%, 75%, and 100% blends with the released independent Passing Yards point head.

## Chronology and gates

Train through 2023, select on 2024, confirm on 2025, then open completed 2026 Weeks 1-5 and the exact
16 offered Passing Yards rows. A candidate must improve selection and confirmation MAE/RMSE, then
improve current offered MAE/RMSE without worse threshold direction. Report week stability and
game-clustered uncertainty before any probability or product-impact stage.

## Safety

Prop lines, prices, sides, books, consensus, movement, splits, and target-game outcomes are excluded
from the forecast. The evaluated line is read only after freezing the candidate for direction
scoring. Research writes ignored local artifacts only; production releases, market reading, writer,
lease, member rows, tracking, and locked payloads remain unchanged.
