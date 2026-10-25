# NFL three-state market-reader production release

Date: 2026-10-25

Status: owner-approved provisional production release for future unlocked games

## Defect and repair

The exact loss-ledger replay showed that the active zero-weight reader was useful for Totals but
effectively inert for NFL sides: it made 14 Total changes (11 corrections, 3 harms) and zero
Moneyline or Spread changes. The repair does not blend the market into the independent score.
Instead it distinguishes confirmation, value/Spread resistance, and an outright outcome correction.

The rejected broad side-flip diagnostic also showed why the boundary distinction is required: it
transferred the independent model's confidence to the opposite team and could assign roughly 74%
win probability to a team still priced around +255. The released rule cannot make that incoherent
reflection; a winner change requires the target-excluded fair Moneyline itself to cross 50%.

A side read is qualified only when persistent, unreversed target-excluded named-book price movement
has fresh same-direction flow from a separate source and no opposing flow. It may change the outright
winner only when the median no-vig Moneyline from at least three fresh, distinct, target-excluded
book families also crosses 50% in that direction. Otherwise it is value resistance: it may reflect
the coherent margin across the target-excluded Spread boundary only when the independent winner is
preserved. Total is unchanged.

The same market read cannot create a new actionable Moneyline. It may demote a resisted actionable
Moneyline. A Spread Watchlist becomes Lean only when the value-resistance correction actually
changes the Spread side, the new side matches the qualified authority, exact-price EV is
nonnegative, and model probability is at least target-excluded fair probability. This lane cannot
promote a Best Angle.

## Exact replay

The release-pure exact-provider/checksum-matched cohort contains 74 completed games.

| Metric | Current | Three-state |
| --- | ---: | ---: |
| Winner accuracy | 49-24-1 (67.1%) | 50-23-1 (68.5%) |
| Spread accuracy | 37-35-2 (51.4%) | 42-30-2 (58.3%) |
| Spread +3 | 49-25 (66.2%) | 52-22 (70.3%) |
| Spread +6 | 55-18-1 (75.3%) | 57-16-1 (78.1%) |
| Moneyline actionables | 7-9, -2.99u | 8-4, +2.77u |
| Spread actionables | 9-11, -2.53u | 12-9, +2.33u |
| Total actionables | 14-2, +10.97u | unchanged |
| Full board | 30-22, +5.45u | 34-15, +16.07u |
| Actionable count | 52 | 49 |
| Team-score MAE | 6.950 | 6.894 |
| Margin MAE | 9.139 | 8.883 |

Prediction directions change by one Moneyline correction and five Spread corrections, with zero
observed harms. Grade impact is two Spread promotions, four Moneyline demotions, and one Spread
demotion. The earliest 39 eligible games are unchanged. The later 17-game evidence-rich partition
moves from 10-11/-1.99u to 14-4/+8.63u. The October 25 live-input 14-game/42-decision current-board
rehearsal changes zero picks, probabilities, or grades and reports zero health holds.

## Limitation, authority, and rollback

The broad categorical signal family was inspected before the three-state refinement, the older
partition contains no qualifiers, and no complete 2024/2025 forward-evidence store exists. This is
therefore strong exact diagnostic evidence, not a pristine untouched holdout. Daniel Mengel
explicitly approved the provisional future-games-only release on 2026-10-25.

Existing locked payloads retain unconditional reader precedence and are never recomputed,
regraded, or reinterpreted. Rollback restores r33/r28/r27/r36 for future unlocked rows only. The
single authoritative writer and `prediction_pipeline:nfl` lease remain unchanged.
