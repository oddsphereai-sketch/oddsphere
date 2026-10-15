# CFB FBS benchmark and injury-authority decision

Date: 2026-10-15  
Status: release-pure retrospective audit; no new scoring authority

## Decision

Keep the active October 14 correct-QB final-winner coordinator. Do not add a
conference-report injury penalty to prediction, probability, grade, or stake yet.
The coordinator has already produced a material, holdout-positive Moneyline gain,
while the historical official-report sample cannot validate a starter-availability
effect without inventing labels after the result.

## FBS-only Moneyline result

The exact 211-game FBS-vs-FBS locked population was joined by immutable game ID to
the frozen 348-row correct-QB coordinator validation artifact. The incumbent reader
and released coordinator were scored against the same actual result for every game:

| Block | Games | Incumbent | Correct-QB coordinator | Net wins |
| --- | ---: | ---: | ---: | ---: |
| Development | 111 | 96-15 (86.5%) | 95-16 (85.6%) | -1 |
| Confirmation | 55 | 38-17 (69.1%) | 41-14 (74.5%) | +3 |
| Holdout | 45 | 28-17 (62.2%) | 32-13 (71.1%) | +4 |
| **All FBS-vs-FBS** | **211** | **162-49 (76.8%)** | **168-43 (79.6%)** | **+6** |

Ten FBS winner-boundary interventions produced eight corrections and two harms.
The untouched holdout improved by four wins. A target-book-excluded market-favorite
baseline covered 203 of these games and finished 155-48 (76.4%), below both the
released coordinator and its 79.6% FBS result.

The externally supplied competitor screenshot reports 372-76 (83.0%) across 448
Moneyline bets. That is a useful raw target, not a normalized head-to-head result:
the competitor has more than twice as many observations as the 211-game FBS-vs-FBS
population and its game identity, FBS/FCS mix, lock time, sportsbook, price, and
release semantics are unavailable. The honest status is that the released
coordinator narrowed the raw percentage gap from 6.3 to 3.4 points on the clean
FBS population; it has not yet proven superiority over a matched competitor set.

## Why the injury report does not get scoring authority yet

The immutable historical availability export contains 22 verified conference
reports. Eleven list at least one quarterback, but zero reports uniquely matched
the expected starter stored for that game. The listed quarterbacks were commonly
reserves or depth players. Treating every listed `out`, `questionable`, or
`game-time decision` quarterback as a starter penalty would therefore manufacture
false injuries and contaminate the model.

The October 15 zero-write current-board replay is better: 26 official reports and
7 exact expected-quarterback matches, including 4 `out` designations with a named
replacement. Those rows establish that the repaired collector can capture the
right evidence. They do not yet establish out-of-sample effect size or calibration.
Until enough immutable locks and outcomes accumulate, conference reports remain
authoritative for lineup display and continuity only. The corrected-QB coordinator
continues to own scoring because it has release-pure historical and holdout evidence.

## Operational follow-up

After the per-game cadence correction is deployed, verify report capture at every
due unlocked cycle and retain exact report timestamp, source, team, player,
designation, expected-quarterback match, and replacement. Evaluate future outcomes
by frozen release and locked timestamp. Promote injury authority only after a
predeclared replay shows corrections, harms, calibration, cross-market impact, and
board counts; locked records must remain untouched.
