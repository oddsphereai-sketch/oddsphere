# NFL professional market authority r29 qualification record

Status: candidate frozen after opened retrospective development; not approved for publication.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

## Honest evidence boundary

This is not a pristine pre-outcome holdout. Weeks 1-5, the 18 paid-score locks, and the ARI-NYG failure
were observed while diagnosing the market reader. The final rule is therefore justified by source identity,
time-safe mechanics, target exclusion, economic plausibility, and consistency across release-pure replays;
its observed hit rate is development evidence and cannot be advertised as a guaranteed future rate.

The candidate is frozen before publication testing. No further outcome-selected threshold tuning is allowed
inside r29. A future change requires a new identifier and a new result record.

## Frozen authority

- Moneyline: two remaining Circa/Pinnacle price trails must agree, persist for at least two-thirds of the
  post-move window, and show no reversal or buyback. Moneyline cannot replace the projected winner unless
  the independently qualified Spread authority agrees with the same winner.
- Spread: at least two target-excluded books must show same-direction number and no-vig-price movement,
  at least two-thirds must agree, and a fresh qualifying money-minus-ticket split must align. Opposing named
  flow vetoes. This explicitly rejects line/price movement without flow authorization.
- Total: target-excluded number movement must have at least two sources and two-thirds agreement. Authority
  then requires either two aligned named price-book number moves, or at least five aligned stable retail
  movers with no opposition or named opposition, selected-book confirmation, all-book confirmation,
  persistence of at least two-thirds, and no reversal or buyback.
- Every evaluated sportsbook family is excluded before authority is resolved. Moneyline and Spread share
  the final margin-axis exclusion set; Total uses its own exclusion set.
- Qualified authority may move the projected score enough to flip a side. The rebuilt joint distribution
  remains the only source of final score, Moneyline, Spread, Total, probabilities, and grades.
- Missing absolute handle, ticket count, bet size, limits, market origin, or suspension lifecycle remains
  unavailable and cannot be inferred.

## Frozen gates

Publication fails if any of the following occurs:

- the exact current-release replay creates a side harm;
- Moneyline or Spread regresses versus r28;
- two or more decision Brier scores regress;
- an actionable market becomes empty or the total actionable board falls below r28;
- score, side, probability, and grade do not derive from one final distribution;
- the audit and runtime use different authority implementations;
- an r28 or r27 locked member snapshot loses exact reader precedence;
- writer, lease, provider cadence, lock boundary, stake, copy, label, or layout changes;
- focused tests, `npm run verify:model-change`, or integration safety fails.

The required report includes release-stratified 65-lock results, the exact 18-lock r28 comparison, every
correction and harm, promotions/demotions, complete board count, missing evidence, and rollback identifiers.
