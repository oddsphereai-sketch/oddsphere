# NFL player-props Passing Completions direction result

Date: 2026-10-27
Starting production base: `81e99c5ac99b76fdc7db89f5b19f28a3cd9861db`

## Outcome

The candidate qualifies for future-unlocked NFL Passing Completions forecasts. It does not add an
Over quota or a generic market weight. The independent Passing Completions point model remains the
starting projection. A fresh target-book-excluded market direction may cross that projection only
when the two directions disagree; agreement preserves the incumbent posterior. Receptions retains
its independent-direction authority and every other prop market remains unchanged.

## Exact chronological evidence

The read-only replay used 54 exact canonical member-line decisions from the current r32 family.
Week 6 is the selection block and Week 7 is the later confirmation block.

| Block | Incumbent | Candidate | Brier incumbent → candidate |
| --- | ---: | ---: | ---: |
| Week 6 | 15-13 (53.6%) | 16-12 (57.1%) | 0.28705 → 0.24436 |
| Week 7 | 12-14 (46.2%) | 13-13 (50.0%) | 0.30413 → 0.27243 |
| Combined | 27-27 (50.0%) | 29-25 (53.7%) | 0.29527 → 0.25787 |

The direction mix changes from 22 Overs / 32 Unders to 32 / 22. The gain is not a quota: it is the
result of a fixed market-specific disagreement rule, and both chronological blocks improve. A
blanket +1 completion lift reached the same aggregate direction result but was rejected because it
would worsen the longer historical projection-bias evidence. Passing Attempts was also rejected:
its market-side candidate was 12-16 in Week 6 despite improving later. Passing Yards candidates that
looked stronger required market-dominant weighting and therefore did not meet the independent-model
contract.

## Current unlocked board impact

The production-default read-only Week 8 rehearsal used 4,931 exact offers, 1,756 feature rows, 89
effective Pinnacle/NoVig reference offers, and 523 member decisions. Passing Completions keeps all 12
member rows, changes four projection values, and changes two forecast sides. It produces zero Passing
Completions promotions, zero demotions, and zero actionable-count change, so this release neither
flattens nor floods that market. All current completion rows remain exact-price and projection/side
coherent.

## Safety and rollback

- Existing locked rows retain their exact stored payload and reader precedence.
- Provider calls, cadence, UI, copy, labels, sole-writer topology, and the shared
  `prediction_pipeline:nfl` lease are unchanged.
- The complete affected forecast, model, calibration, decision, member, lifecycle, writer, and
  tracking family is release-versioned.
- Rollback applies only to future-unlocked evaluation. Never rewrite a prior lock.
