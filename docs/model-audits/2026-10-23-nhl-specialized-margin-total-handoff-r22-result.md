# NHL specialized margin/Total handoff r22 result

Date: 2026-10-23

Status: passed every frozen gate; production candidate.

## Fixed architecture

- Games 0-6: qualified fast-state winner/margin and Total heads.
- Games 7-9: roster head owns independent winner/margin; fast-state head owns
  independent Total.
- Games 10+: unchanged mature statistical path.
- The two independent axes are solved into one score tuple before the existing
  Moneyline and target-excluded Total readers. No weighted model blend or
  market anchor is introduced.

## Untouched 2025 confirmation

Across 153 exact opening-window games, Moneyline remains 80-73. Brier changes
from 0.24785 to 0.24791, puck direction from 111-42 to 110-43, Total direction
remains 81-72, margin MAE changes from 1.9763 to 1.9801, and Total MAE remains
1.9349. Every change is inside the original frozen handoff tolerances.

## Release-pure 2026 replay

| Cohort | Measure | r20 | r22 candidate |
| --- | --- | ---: | ---: |
| Full 165 | Moneyline | 102-63 | 107-58 |
| Full 165 | Moneyline Brier | 0.23212 | 0.23018 |
| Full 165 | Margin MAE | 2.16967 | 2.13081 |
| Full 165 | Total direction | 81-83-1 | 81-83-1 |
| Full 165 | Total MAE | 1.71291 | 1.71291 |
| Combined r18/r20 | Moneyline | 22-25 | 27-20 |
| Combined r18/r20 | Margin MAE | 2.29627 | 2.17400 |
| Combined r18/r20 | Total direction | 23-24 | 23-24 |
| Combined r18/r20 | Total MAE | 1.51507 | 1.51507 |

Exact-price actionables improve from 319 at 187-131-1 / -3.31u to 311 at
187-123-1 / +7.38u. The candidate has 14 promotions and 22 demotions. Selection
improves from 233 at 142-90-1 / +8.19u to 232 at 142-89-1 / +8.93u. Combined
confirmation improves from 86 at 45-41 / -11.50u to 79 at 45-34 / -1.55u.
The r20-only cell moves from 22 at 11-11 / -3.21u to 19 at 9-10 / -3.26u,
exactly the maximum one-net-win loss permitted by the frozen gate.

By full-cohort market, Moneyline improves from 108 at 65-43 / +0.18u to 111
at 76-35 / +17.60u. Puck-line actionables contract from 99 at 67-32 / +5.24u
to 88 at 56-32 / -1.50u; direction remains 104-61 versus 106-59 and satisfies
the frozen direction tolerance. Totals are intentionally unchanged at 112,
55-56-1 / -8.73u pending a separately qualified grade change.

## Current board and safety

The exact October 23 sole-writer dry run replays all 165 required prior games
and produces six complete market records with zero errors. Against the stored
member board, all six picks and grades are unchanged: two actionables and four
Watchlists. A separate SELECT-only production-parity replay matches the frozen
candidate on all 165 settled games, with 165 exact categorical matches, zero
numeric difference, and zero failures. The release changes no writer, cadence, provider hierarchy, line,
price, market-reader rule, or stake mapping. Transition releases preserve every
locked r18-r20 tuple, and reader tests prove stored locked payload precedence.

Rollback is limited to future unlocked output by restoring the r20/r16 runtime
identifiers and opening-head boundary. No locked row may be rewritten.
