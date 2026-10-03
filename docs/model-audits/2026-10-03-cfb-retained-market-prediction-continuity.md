# CFB retained market-prediction continuity

## Predeclaration

The production r31 evidence release correctly retains the latest verified sportsbook price and
line when a later provider cycle omits a market. The member surface nevertheless suppresses a
Spread or Total prediction after an unrelated ten-minute display timer, producing an internally
contradictory card: the exact verified line, price, and same-book trail remain visible while the
line-specific prediction is labeled unavailable.

The candidate changes only the member publication contract. When a retained market outlook has a
finite line and a real observation timestamp that is not in the future, publish the authoritative
joint-PMF prediction at that exact retained line. Preserve No Play whenever exact-price grading
requirements are incomplete. Do not change numerical projections, sides, probabilities, grades,
actionable counts, lock state, or tracking records.

Acceptance criteria:

- all 99 current games remain on the board;
- every market with a verified retained line and observation timestamp publishes its line-specific
  prediction;
- retained evidence keeps its real sportsbook, price, line, and observation time;
- missing lines still publish `market_data_unavailable`;
- all pre-existing locked games remain byte-for-byte terminal at their stored lock timestamp;
- focused CFB tests, TypeScript, model-change verification, and integration safety pass.

## Result

The candidate removes the independent ten-minute presentation expiry for already retained verified
market context. Current-board audit impact is exactly 15 Spread and 15 Total prediction surfaces
restored. Five games without a verified timestamped quote remain unavailable. Numerical forecasts,
picks, probabilities, grades, promotions, demotions, and actionable board counts do not change.
The missing-line fixture remains unavailable, and the 15-minute retained-quote fixture proves that
Moneyline, Spread, and Total predictions stay available without manufacturing a Bet selection or
grade.
