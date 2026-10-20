# UCL minimum coherent decimal score r11

Date: 2026-10-20

## Decision

Advance only future-unlocked UCL rows to
`ucl_goals_coherent_2026_10_20_r11_minimum_coherent_decimal_score` and primary
score semantic
`ucl_projected_score_2026_10_20_r2_minimum_coherent_decimal`.

The r9/r5 PMF, market reader, probabilities, sides, exact prices, r13 grades,
stakes, providers, cadence, writer, shared `prediction_pipeline:soccer` lease,
tracking, and settlement do not change. Existing locked cards and rows retain
their exact stored public payload.

## Product correction

R10 proved directional coherence by publishing the PMF's coherent exact-score
representative, but the owner correctly identified that an exact 3-0 removes
the continuous simulation character of the primary score. Its authenticated
refresh was cadence-skipped, so the member board did not advance to r10 before
this refinement.

R11 starts with the full reconciled-PMF expected goals. If their one-decimal
display already agrees with the final Match Result, Over/Under 2.5, and BTTS
leaders, it changes nothing. If the display conflicts, it interpolates toward
the same PMF's coherent representative outcome in one-percent steps and stops
at the first score whose one-decimal display agrees with all three directions.
This is the minimum visible correction. It is not an exact-score claim, a new
prediction head, a market weight, or a hand-authored team adjustment.

For decimal display semantics, a BTTS No projection requires at least one team
below 0.5 projected goals; BTTS Yes requires both at or above 0.5. Match Result
and the 2.5 total are evaluated directly from the displayed tenths.

## Same-input current-board impact

The persisted 18-game member snapshot contains 16 open and two locked games.
On that exact input:

- 14 of 16 open primary scores remain unchanged;
- Roma-Slovan Bratislava moves from Roma 3.31 / Slovan Bratislava 1.10 to
  Roma 3.1 / Slovan Bratislava 0.4;
- Atlético-Stuttgart receives the only other minimum winner-direction repair;
- all 16 open one-decimal scores agree with Match Result, Total, and BTTS;
- zero locked projections change;
- zero sides, probabilities, prices, grades, stakes, promotions, demotions, or
  actionable counts change.

The original expected-goals means remain available in
`soccerProjection.expectedGoals` as distribution evidence.

## Verification and rollback

Publication requires focused UCL production and immutable-lock tests,
TypeScript, the full model-change suite, production build, same-input board
coherence, latest-main integration safety, protected PR checks, and live proof
that r11 applies only to unlocked rows. Roll back future-unlocked generation to
r9 score presentation if any primary score conflicts with a released direction
or any probability, side, price, grade, stake, locked payload, writer, lease,
tracking, or provider-coverage invariant changes.
