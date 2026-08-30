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
