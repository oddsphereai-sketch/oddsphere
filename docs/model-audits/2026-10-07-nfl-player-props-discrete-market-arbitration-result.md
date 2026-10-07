# NFL player props discrete market arbitration result

Date: 2026-10-07  
Starting production base: `4f4c1db4a2990d5c38c98e58a57a70b1092f873d`

## Decision

Promote only the predeclared receptions subrule. Preserve the incumbent
receiving-yards and every other market path.

The broad predeclared receiving-yards candidate was rejected by the exact
production-runtime A/B: it lost one of 34 settled Week 4 directions. Returning
the independent raw probability on same-direction receptions rows was also
rejected because it expanded actionables from 9 to 26 while the added plays
won only 8 of 16. Neither rejected behavior is present in the release.

The surviving rule applies only when all of the following are true:

- market is receptions;
- at least one same-line target-book-excluded benchmark exists;
- independent and target-excluded market directions disagree; and
- the target-excluded market probability is at least five percentage points
  from 50%.

It then uses the target-excluded market probability as the final probability
and inverse-solves the existing empirical posterior for one coherent displayed
projection. Otherwise the incumbent market-specific posterior is unchanged.
Exact evaluated price and grades remain downstream.

## Release-pure Week 4 A/B

The replay used the same 1,115 captured offers, 249 pregame feature rows and
runtime code for incumbent and candidate. It made zero provider calls and zero
writes. All 720 evaluated rows matched.

- canonical settled over/under scopes: 291
- forecast direction: `163-128 -> 165-126`
- Brier: `0.260825 -> 0.260116`
- log loss: `0.728196 -> 0.726743`
- calibration gap: `0.104162 -> 0.102682`
- receptions direction: `42-43 -> 44-41` on 85 settled scopes
- receptions Brier: `0.267971 -> 0.265545`
- receptions log loss: `0.737246 -> 0.732272`
- receptions calibration gap: `0.147132 -> 0.142063`
- side changes: 2
- projection changes: 24 evaluated side rows
- actionables: `9 -> 9`
- promotions: 0
- demotions: 0
- actionable record and locked-price units: `6-3 / +0.119887 -> 6-3 / +0.119887`

All non-receptions markets are numerically identical apart from the new release
identifiers. Existing locked rows remain immutable.

## Current Week 5 zero-write board audit

The production snapshot generated at `2026-10-07T05:36:09.456Z` contains 828
member rows. The candidate changes two unlocked receptions probability and
projection rows, changes zero forecast sides, and leaves the board exactly at
1 Best Angle / 4 Leans / 89 Watchlists / 734 No Plays, five actionables, zero
promotions and zero demotions.

## Operational impact and rollback

The release adds no provider call, database loop, writer, schedule, stake,
member copy, label, or layout. The sole writer and
`prediction_pipeline:nfl` lease remain authoritative. The preceding full
release family is the rollback target. Hold or roll back unlocked candidate
output on mixed release identifiers, missing games or prices, projection/side
incoherence, reader failure, writer overlap, lock failure, or unexpected board
collapse. Never rewrite prior locks.

