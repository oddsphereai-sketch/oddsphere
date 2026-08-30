# CFB unit-probability bound production recovery — 2026-08-30

## Pre-edit production evidence and scope

The first natural week-ahead writer after the dated prior-results repair failed atomically at
`2026-08-30T18:24:48.572Z` with `CFB moneyline independent outlook probability is invalid.` No
new CFB evidence or member rows were written. A read-only reproduction over all 106 eligible
Sept. 3–7 games separated the independent and authoritative paths:

- all independent forecasts were finite and inside `[0, 1]`;
- Arkansas–Pine Bluff at Missouri (`458238`) had a coherent four-book anchor of Missouri -54
  and Total 61.75;
- the 75% market / 25% independent normalized PMF summed its home-win cells to
  `1.000000000000001`, while the mathematical result was exactly 1;
- the strict evidence-outlook validator therefore rejected the entire atomic wave.

The sole affected runtime is the existing CFB forward-evidence writer under
`prediction_pipeline:cfb`. MLB, other sports, provider requests, scheduling, PMF weights,
market/sharp inputs, score projections, grade thresholds, stakes, locks, and readers are outside
this patch.

## Frozen correction

The authoritative market/sharp PMF summary now bounds a finite winner probability to `[0, 1]`
only when its floating-point overshoot/undershoot is no more than `1e-12`. A materially invalid
probability still throws and preserves the last coherent snapshot. PMF cells and their normalized
mass are unchanged, so expected scores, representative scores, exact-line probabilities, sides,
EV, and grades are unchanged for every already-valid forecast.

The runtime, model, probability, decision, production candidate, writer, fixture, public-outcome,
and tracking identifiers are advanced. Distribution, representative-score, calibration, grade,
tuple, evidence-schema, collector, member, and presentation identifiers remain unchanged because
their math or contract does not change.

## Required proof

- the exact dominant-favorite regression publishes 1 rather than an out-of-range float;
- materially invalid values remain rejected;
- focused CFB market/sharp, weekly, production, fixture, tracking, and provider tests pass;
- `verify:model-change`, repository verification, TypeScript, focused lint, production build, and
  integration safety pass from a clean current-main branch;
- the next natural leased writer emits one complete Sept. 3–7 wave with the new release set;
- the signed-in CFB Daily Edge reader shows the week-ahead slate and MLB remains current.

## Downstream coherence recovery

The first post-r44 natural run at `2026-08-30T18:54:48.589Z` passed the endpoint normalization
but failed atomically because the shared cross-market forecast guard still required both winner
probabilities to be strictly inside `(0, 1)`. It reported the same UAPB–Missouri forecast as
`Away/home win probabilities are 0/1` and again wrote zero rows.

Writer r32 opts CFB into exact endpoints only when a joint PMF is present. The shared r5 guard
then still verifies finite closed-interval probabilities, complementary mass, PMF mass, expected
scores, and PMF-derived winner probability. Missing or malformed PMF proof remains fatal. The
option defaults off, so NFL and every other existing caller retain the prior open-interval rule.
This is a publication-validation correction only; the r44 PMF, projections, decisions, grades,
stakes, locks, and provider load do not change.

## Near-toss-up Total disposition

The first natural r32 run at `2026-08-30T19:54:48.422Z` passed the endpoint guard and then failed
atomically on Indiana State–Purdue (`457616`). Four named books centered the Total at 57.5. The
authoritative PMF assigned Under 50.20% and Over 49.80%, while its mean was 57.8313 and its
reachable representative score totaled 58. The exact Under -110 tuple was already `No Play` at
50.10% calibrated probability, 0.10pp edge, and -4.35% EV. This is a distribution-shape toss-up,
not support for a public Under prediction and not grounds to weaken the cross-market guard.

Writer r33 moves only a negative-EV Total `No Play` into an explicit operational hold when all of
these are true: PMF advantage from 50% is no more than one percentage point, PMF and mean select
opposite sides, and the mean is no more than 0.5 points from the exact line. It also removes that
market's outlook so the reader cannot publish a prediction that conflicts with the score summary.
Actionable grades, nonnegative-EV tuples, gaps over one percentage point, and mean distances over
0.5 points remain subject to the unchanged fatal coherence gate. Moneyline, Spread, other games,
stakes, provider load, and the r44 forecast PMF are unchanged.
