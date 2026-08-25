# CFB v1 representative score functional predeclaration

Date: 2026-08-25

Status: frozen before regenerating the current-slate artifact

The one-decimal expected points from the qualified joint PMF remain the primary
score projection. The earlier secondary modal score was defective because a
low-frequency but individually common joint pair could be far from the PMF
means (including implausible zero-point representatives).

The replacement secondary score must be a joint pair with nonzero probability
in the same PMF. Among reachable pairs, it first preserves the projected winner
whenever home win probability is not exactly 50%. It then minimizes squared
distance from expected home and away points plus squared distance from expected
margin and expected total, with higher joint mass as the final tie-breaker.

Release gates on the current board are predeclared as:

- 100% winner-direction fidelity for non-50% games;
- no representative tie for a non-50% projected winner;
- maximum four-point deviation from the expected margin and total;
- maximum four-point deviation for either team's expected points;
- no zero-point representative for a team expected to score at least 10;
- every representative pair must have positive mass in the exported PMF.

The current-board report will include those metrics, the number of duplicate
representative pairs, and the largest team/margin/total deviation. These gates
change only secondary context; PMF probabilities and decimal expected points
cannot be altered to make the representative score pass.
