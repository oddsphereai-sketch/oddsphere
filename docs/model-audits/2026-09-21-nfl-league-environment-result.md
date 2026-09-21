# NFL pre-week league-environment correction result

Date: 2026-09-21

Tournament: `nfl_league_environment_tournament_2026_09_21_r1`

Decision: rejected; research only; no production behavior changed

## Spread

The selected pre-week environment correction was worse than market on pooled
2024-2025 MAE (9.671177 versus 9.666360), Brier (0.250372 versus 0.250325),
and direction accuracy (48.72%).  It generated no actions at the fixed edge
threshold and failed the confirmation gate.

## Total

The total correction improved pooled MAE from 10.061581 to 10.058004 and Brier
from 0.250094 to 0.249890, with 53.05% correction-direction accuracy.  The
improvement did not generalize cleanly: 2025 MAE and Brier were both worse than
market.  More importantly, all 377 actions were Overs and went 193-183-1 for
-7.647 units and -2.03% ROI.  It failed cross-season, positive-economics, and
both-direction gates.

This candidate is not a defensible way to make the public board less
Under-heavy.  It would exchange visible balance for a historically losing,
one-direction action lane, so it remains rejected.

## Combined 2026 diagnosis

- Week 1 official results: Moneyline 9-4, Spread 4-9, Total 7-5-1.
- Week 2 official results: Moneyline 9-5, Spread 5-8-1, Total 5-9.
- Week 2 tracking and settlement reconciliation passed with no mismatches.
- The Week 2 production score forecast was only 0.29 points from the market on
  margin and 0.75 points on total on average.
- The Week 2 football-only margin signal was not a hidden fix: it went 5-9 and
  had 12.337 MAE versus 11.821 for market.  Increasing its weight would have
  worsened the week.
- The previously accepted player/QB total shadow improved Week 2 side results
  from 5-9 to 7-7, but worsened point MAE from 10.143 to 10.188.  One already
  observed week is not forward proof and does not authorize promotion.

Four newly predeclared historical challengers were tested in this audit:
market-context residual regression, coherent team-score residual regression,
direct side classification, and pre-week league-environment correction.  None
passed the complete accuracy, cross-season, action-sample, economics, and
two-direction contract.  No post-hoc inversion, board flattening, added UI copy,
or release-stamp-only change was made.

The valid next evidence path is the existing immutable weekly T-60 stream.  A
future candidate must be predeclared against that stream and pass by release;
the 9-17-1 two-week Spread result may be monitored as a counter-signal
hypothesis, but cannot be fitted and launched after observing those same games.

