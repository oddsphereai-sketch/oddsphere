# NHL seven-game opening-head handoff r21 result

Date: 2026-10-23

## Decision

Do not publish the seven-game handoff in this task. It is a materially better
Moneyline and point-projection candidate, but the follow-up exact-price puck-line
gate failed. The live r20 release remains unchanged and every locked member
snapshot remains immutable.

## What was tested

The fixed candidate uses the released fast-state direct-probability head while
both teams have fewer than seven current-season games. From seven through nine
games it hands the entire coherent score and outcome distribution to the
already-released roster-prior head. At ten games the existing mature statistical
path remains unchanged. The existing qualified Moneyline and target-excluded
Total readers remain downstream.

The 2026 replay contains 165 complete, exact-price, settled transition games.
All fast and roster states were reconstructed from strictly pre-slate inputs.
The frozen fast reconstruction reproduced the stored current architecture with
zero score, side, or probability differences.

## Independent/final prediction result

| cohort | current Moneyline | handoff Moneyline | current Brier | handoff Brier | current margin MAE | handoff margin MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-r18 selection (118) | 80-38 | 80-38 | 0.22302 | 0.22027 | 2.119 | 2.114 |
| r18 confirmation (35) | 18-17 | 22-13 | 0.25559 | 0.23601 | 2.143 | 2.012 |
| r20 confirmation (12) | 4-8 | 5-7 | 0.28729 | 0.27072 | 2.743 | 2.648 |
| full (165) | 102-63 | 107-58 | 0.23460 | 0.22728 | 2.170 | 2.131 |

Full-cohort puck-line direction moved from 106-59 to 104-61 and Total direction
from 81-83-1 to 80-84-1. Team-score MAE improved from 1.384 to 1.375; Total MAE
was effectively unchanged at 1.713.

The independently rebuilt 2025 priced opening cohort contained 153 games. The
current fast boundary and seven-game handoff both went 80-73. Candidate Brier
moved only from 0.24785 to 0.24791, inside the predeclared 0.005 tolerance. The
broader frozen research pipeline also reproduced its published 2025 707-605
Moneyline result and exact selected coefficients, establishing source parity.

## Market-reader diagnosis

The qualified Moneyline reader changed four of the 165 reconstructed games: it
corrected three and harmed one. It therefore adds value overall, but is
intentionally sparse and is not the cause of the opening-head weakness.

The target-excluded Total reader also helps rather than hurts. In the existing
authority sensitivity replay, independent Total direction was 78-86-1; full
qualified authority improved it to 83-81-1. That does not make the Total head
strong: it shows that the reader partially repairs a weak independent Total
signal.

## Exact-price board result

Across all three markets, the current architecture produced 319 actionables at
187-131-1 and -3.31 units. The handoff produced 311 at 186-124-1 and +5.45
units. It included 14 promotions and 22 demotions, so the board did not change
through a one-way flattening mask.

Moneyline actionables improved materially:

- current: 108, 65-43, +0.18 units;
- handoff: 111, 76-35, +17.60 units.

Puck-line actionables did not pass the follow-up transfer check:

- current: 99, 67-32, +5.24 units, Brier 0.21142;
- handoff: 88, 56-32, -1.49 units, Brier 0.21996.

The candidate's lower puck-line probability is not merely a display threshold.
Most removed plays have negative exact-price edge under the candidate's coherent
distribution. Restoring their old grades would preserve outcomes known after the
fact while contradicting the candidate probability and price. That is not a
valid calibration.

Totals remain the weakest lane. Handoff actionables were 54-57-1 and -10.65
units, compared with 55-56-1 and -8.73 units under the current head. The score
handoff is therefore not a Total repair.

## Current board and next valid path

The unlocked 2026-10-23 board has two games, six markets, two Leans, and four
Watchlists: one Moneyline Lean, one puck-line Lean, and zero actionable Totals.
The immediate board is not overpopulated.

No post-result threshold search is authorized. A future puck-line probability
calibration must fit on a separate historical selection cohort and confirm on an
untouched season/current release. A future Total change must improve the
independent Total head or qualify a structurally stronger target-excluded read;
demoting nearly every Total is not an accuracy repair.

