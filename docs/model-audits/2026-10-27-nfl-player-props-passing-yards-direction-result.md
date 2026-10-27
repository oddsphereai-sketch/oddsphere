# NFL player-props Passing Yards direction r38 — result

## Decision

Qualified for future-unlocked Passing Yards forecasts. The release adds one narrow direction rule:
when the independent and target-book-excluded Passing Yards directions disagree and the market read
is at least one percentage point from 50%, the market direction owns the final posterior. The
independent point projection remains stored and market-free. Agreement, missing evidence, and
sub-one-point market toss-ups retain the incumbent posterior.

This release does not impose an Over quota, alter another prop market, change grade thresholds, add
copy or labels, add a writer, change cadence, or expand provider budgets.

## Exact canonical-line evidence

The read-only release-pure replay contains 54 settled canonical member-line forecasts from Weeks 6-7.
The audit normalizes the Week 6 tracking export's selected-side probabilities and the Week 7
canonical export's already-normalized Over probabilities before applying the identical frozen rule.

| Window | Incumbent | Candidate | Changes | Corrections | Harms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Week 6 | 14-14 (50.0%) | 17-11 (60.7%) | 3 | 3 | 0 |
| Week 7 | 14-12 (53.8%) | 16-10 (61.5%) | 2 | 2 | 0 |
| Combined | 28-26 (51.9%) | 33-21 (61.1%) | 5 | 5 | 0 |

The four already-actionable historical rows remain unchanged at 1-3. This release therefore does not
claim to repair the Passing Yards grade lane; it improves the complete forecast board without hiding
those existing grade results. No actionable promotion or demotion is manufactured from the replay.

## Current-board rehearsal

The production-default Week 8 no-write rehearsal retained all 523 member rows and all 12 Passing
Yards side rows. At the rehearsal timestamp, no current Passing Yards scope met the new disagreement
rule, so Passing Yards produced zero side changes, zero promotions, and zero demotions. The member
actionable count remained 12. Existing Passing Completions and Receptions behavior remained intact.

The rehearsal performed no member, tracking, or database write. The sole writer and shared NFL lease
are unchanged. Stored locked records continue to take exact precedence.

## Release and rollback

Portable artifact / model / calibration / decision / runtime / board advance to r21/r32/r34/r38/r39/r42.
Member / lifecycle / sole writer / tracking advance to r51/r33/r65/r39. Roll back those future-unlocked
identifiers together to the Passing Completions family if a natural production cycle changes another
market, drops member rows, creates a projection/side contradiction, or changes an immutable lock.
