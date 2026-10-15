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

## Whole-product comparison, not Moneyline only

The closest same-date published-product comparison covers different populations
and is therefore diagnostic rather than a head-to-head proof:

| Market | OddSphere published | Competitor screenshot | Raw delta |
| --- | ---: | ---: | ---: |
| Moneyline | 276-100 / 376 (73.4%) | 372-76 / 448 (83.0%) | -9.6 pp |
| Spread | 191-180-4 / 375 (51.5%) | 221-219 / 440 (50.2%) | +1.3 pp |
| Spread +3 | 226-148-1 / 375 (60.4%) | 251-194 / 445 (56.4%) | +4.0 pp |
| Spread +6 | 254-120-1 / 375 (67.9%) | 285-160 / 445 (64.0%) | +3.9 pp |
| Total | 194-181 / 375 (51.7%) | 213-235 / 448 (47.5%) | +4.2 pp |
| Total +3 | 215-160 / 375 (57.3%) | 245-203 / 448 (54.7%) | +2.6 pp |
| Total +6 | 244-131 / 375 (65.1%) | 282-166 / 448 (62.9%) | +2.1 pp |

These rows answer a limited question: which displayed raw percentages are higher.
They do not establish profitability or matched superiority because exact games,
prices, sportsbook, lock times, subdivision mix, release identity, and void rules
are not shared. Alternate-line percentages are directional cushion tests, not a
claim that a real +3 or +6 offer was available at a profitable price.

The October 14 coordinator improves more than Moneyline. On the exact 298-game
complete-reader comparison, it moves Moneyline 232-66 to 235-63, Spread
101-79-3 to 102-78-3, Spread +3 from 121-62 to 122-61, and Spread +6 from
132-50-1 to 133-49-1. Totals remain unchanged by design. On the broader
276-game forward comparison it adds six Moneyline wins, two Spread wins, two
Spread +3 wins, and one Spread +6 win. A later candidate must therefore report
all seven displayed result lanes plus Brier/log loss, calibration, score error,
exact-price economics, and board-count impact.

## Current feature coverage

The October 15 field-projected production audit read all 97 current games and
their stored coordinator feature snapshots. Every game has finite matchup and
recent-form values for EPA/play, true success, early-down efficiency, pass and
rush EPA/success, QB EPA/success and volume, line yards, stuff rate, opportunity
rate, explosiveness, red-zone and third-down success, drives, yards per drive,
field position, pace, Elo, rest, and reader margin. These matchup values combine
each offense with the opponent's adjusted defensive state rather than relying on
raw yardage alone. The underlying score model also includes points for/against,
special-teams EPA, penalties, expected turnovers, turnover luck, home/neutral
field, and pass-QB and rush-trench interactions.

Three declared personnel features are not populated in the 2026 portable
artifacts: roster continuity, roster experience, and returning-QB status are
missing for all 97 games and all stored team profiles. They are explicitly
imputed with missingness indicators, so this is not silent corruption, but it is
a real information gap. Root cause: artifact generation has historical rosters
through 2025 but no 2026 roster frame. The current BALLDONTLIE team-scoped active
roster feed is already fetched, but the collector discards every non-quarterback
row. The feed exposes stable player IDs and position but no class/experience
field. A future personnel release can therefore recover roster continuity and
returning-QB identity without another provider; roster experience requires a
separate verified source or must remain unavailable.

Current market-input coverage is 92/97 Moneyline quotes, 95/97 Spread, and 95/97
Total. Market home probability is finite for 92 games, while exact named-sharp
Moneyline split evidence is only 1/97, fallback split evidence 46/97, and public
split evidence 58/97. Missing split evidence remains modeled missingness and may
not be interpreted as agreement or resistance.

The next model-authority priorities are therefore: release-pure current-roster
continuity/returning-QB evaluation; calibration repair for overconfident Spread
and Total probability bands without sacrificing their raw and alternate-line
direction; Moneyline upset discrimination; and matched-game competitor capture.
No feature receives live authority merely because it sounds football-relevant.

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
