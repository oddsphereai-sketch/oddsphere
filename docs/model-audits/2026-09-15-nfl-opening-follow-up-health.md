# NFL weekly opening follow-up and evidence-health repair

Date: 2026-09-15

## Incident and declared scope

The Week 2 slate published all 16 games and 48 complete predictions after the
Tuesday rollover, but the production snapshot audit remained unhealthy. The
BALLDONTLIE opening endpoint returned no Week 2 rows, so the first writer wave
correctly used current quotes as its operational first observation. The normal
far-window cadence then waited six hours before collecting again. In addition,
the member movement builder retained that first observation only when its one
representative sportsbook matched the exact sportsbook selected for a market.
The live audit therefore reported opening/current trail coverage 0/16 and a
minimum one same-book observation instead of two.

Affected scope is NFL Moneyline, Spread, and Total evidence cadence, exact-book
movement provenance, compact snapshot publication, and the health reader. The
single `/api/cron/nfl-forward-evidence` writer remains authoritative under
`prediction_pipeline:nfl`. No provider, timer, endpoint, table, parallel writer,
stake path, prediction-record path, or settlement path is added.

## Release contract

- Sole writer: `nfl_forward_evidence_writer_2026_09_15_r27_opening_follow_up`.
- Member fixture: `nfl_weekly_member_fixture_2026_09_15_r19_verified_first_observation`.
- Compact snapshot: `nfl_forward_member_snapshot_2026_09_15_r11_opening_follow_up`.
- Availability fallback: the preceding r10 snapshot/r18 fixture remains readable
  for the existing bounded continuity window.
- Model, calibration, decision, grade, week-selection, coherence, tracking, and
  settlement releases remain unchanged because identical model inputs produce
  identical forecasts, probabilities, sides, prices, and grades.

After a newly rolled slate has one opening-stage row per upcoming game, the
writer waits at least 15 minutes and performs exactly one follow-up unlocked
capture for any game with fewer than two stored observations. T-60 work and a
required public-release refresh retain higher priority. Once every upcoming game
has two observations, the writer returns to the existing six-hour cadence beyond
48 hours, hourly cadence inside 48 hours, and targeted T-60 cadence.

When a distinct provider opening is absent, the fixture records the first
writer-verified current quote for the exact evaluated sportsbook. Later stops use
the writer capture timestamp, so repeated provider verification of an unchanged
quote remains a truthful two-observation first/current trail. It never fabricates
a price move or substitutes another sportsbook's opening.

## Outcome-blind verification

The pre-change production audit was 16 games / 48 predictions / 48 priced
markets, with opening/current trail coverage 0/16 and minimum observations 1/2.
Its grade mix was **0 Best Angles / 0 Leans / 8 Watchlists / 40 No Plays / 0
held games**.

A live-input, no-write r27 replay selected `opening_follow_up_due`, proposed 16
unlocked captures, retained all 48 predictions and the identical 0 / 0 / 8 / 40
grade mix, held zero games, and bounded the follow-up to 11 maximum provider
calls. A no-write two-wave snapshot replay passed health with opening/current
coverage 16/16 and minimum observations 2/2. Same-input promotions, demotions,
side changes, probability changes, price changes, and grade changes are all zero.

The audit continues to warn when a slate contains no actionable grades. That
warning is not converted into a quota and this release does not manufacture a
Lean or Best Angle. Week 2's exact-price tuples currently do not clear the
validated action thresholds. Injury-report and exact named-book split
availability continue to be reported truthfully by the writer and remain
separate from the repaired same-book trail.

## Rollback and live acceptance

Roll back writer r27, fixture r19, and snapshot r11 together to r26/r18/r10 if a
weekly opening follow-up repeats after the second observation, exceeds the
bounded call budget, changes same-input grades, invents a cross-book opening,
overlaps another NFL writer, or disrupts a valid T-60 capture. Preserve all
append-only evidence and immutable tracking rows.

Production acceptance requires the protected PR and integration checks, one
successful follow-up under the existing lease, a released empty lease, a fresh
r11 snapshot with 16 games / 48 predictions / 16 opening trails / minimum two
observations, a healthy snapshot audit apart from any explicit noncritical grade
warning, and a responsive live member board after the next scheduled update.
