# NBA preseason member-board boundary — 2026-10-05

## Scope

The NBA navigation correctly reported `No games today`, and public tracking
correctly excluded the 2026 offseason/preseason window, but the member Daily
Edge API could return a cached five-game preseason rehearsal slate before its
NBA adapter branch ran.

## Repair

The member API now applies the existing NBA public eligibility window before
reading a Daily Edge response snapshot. Dates from 2026-07-01 through
2026-10-19 return an empty NBA board. Valid prior-season dates remain eligible,
and the 2026-27 regular-season board becomes eligible automatically on
2026-10-20. Operational game, line, score, and model rehearsal may continue;
only member visibility is changed.

## Model and board impact

This is not a prediction or calibration change. For identical eligible
regular-season input it changes zero projections, probabilities, sides,
prices, grades, promotions, demotions, or actionable counts. It adds no
provider request, writer, schedule, database loop, copy, label, or layout.

## Verification

- Boundary unit coverage preserves valid June history, excludes the closed
  preseason window, and admits October 20 onward.
- Route regression coverage proves the boundary executes before snapshot
  reads and returns a 200 empty NBA slate for 2026-10-05 without database or
  model work.
- Production verification must confirm the NBA tab and board both show no
  games before the regular-season opener.
