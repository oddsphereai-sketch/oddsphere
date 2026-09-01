# MLB first-inning named-book consensus — r77

Date: 2026-09-01

Status: production candidate; no database writes were made by these audits.

## Change and invariant

FI V2 previously used one priority-selected, same-book NRFI/YRFI pair as both
its market forecast and its offered-price comparison. R77 keeps that exact
pair for price and break-even economics, but builds the authoritative FI
market probability from all fresh, complete, coherent 0.5-run named-book
pairs. Retail-only inventory is eligible even when no supported sharp pair
exists. When both cohorts exist, the sharp median and retail median receive
equal weight; otherwise the available cohort median is used. One complete
named book is sufficient.

Retained FI-specific openings are compared only with coherent current pairs
from the same books. Current-minus-opening movement contributes a fixed 20%
residual to the current consensus, capped at one probability point. This was
declared before the movement replay; it is not fit to outcomes. Missing,
one-sided, stale, or unmatched movement contributes exactly zero and never
holds a forecast. No full-game movement or split signal is mapped into FI.

Missing or one-sided books are neutral. `splits_consensus`, blocked books,
alternate FI totals, stale rows, incoherent captures, and invalid prices are
not probability evidence. No price row is described as a ticket/handle split.
The consensus enters the existing adaptive posterior before side and grade.
The evaluation book, exact American prices, and same-book no-vig fair value
remain separate fields and continue to own action economics.

R77 does not change the full-game projection core or Moneyline/Total heads,
decimal score output, simulated display, stake rules, promotion persistence,
correction policy, locked-row precedence, tracking lifecycle, authoritative
writer, or the sport-scoped `prediction_pipeline:mlb` lease. It adds no reader
panel or member copy.

## Same-input current-board replay

Captured read-only at `2026-09-01T21:42:43.702Z` for the complete 15-game MLB
slate. Both candidates used the same feature snapshots, timestamps, and line
rows. The incumbent replay restricted FI market input to the same exact
evaluation pair; r77 used the complete eligible named-book set.

| Measure | FI v4 incumbent | FI v5 candidate |
| --- | ---: | ---: |
| Complete named-book coverage | 15/15 | 15/15 |
| Supported sharp-pair coverage | 0/15 | 0/15 |
| Same-book FI opening/current coverage | — | 13/15 |
| Projection book breadth | 1 per game | 1–7 per game |
| NRFI / YRFI / Toss-Up | 1 / 6 / 8 | 1 / 6 / 8 |
| Lean / No Bet / Toss-Up | 2 / 5 / 8 | 2 / 5 / 8 |
| Actionable promotions / demotions | — | 0 / 0 |
| Side changes | — | 0 |
| Exact evaluation pair and prices retained | 15/15 | 15/15 |

Four games had multi-book evidence and their posterior consumed that evidence;
the remaining games had one complete current book. Thirteen probabilities and
the corresponding expected first-inning run projections changed together.
Mean absolute expected-run movement was 0.00315512 runs and the maximum was
0.01280974. Natural decimals were retained; no half-run or integer
quantization was introduced. No quota or late grade-only nudge was used.

## Locked chronology

The chronology was filtered to probability release
`mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20` and immutable lock
timestamps. There were 153 finalized locked rows from August 20–31. Historical
storage contained a replayable fresh, coherent named-book board for only 56
rows, all locked from August 28–31; earlier rows retained their locked FI
payload but did not retain the complete price board needed for a valid r77
counterfactual. Those 97 rows were excluded, not reconstructed or backfilled.

The 56-row set spans decision releases r72 (26), r73 (21), and r74 (9). Nineteen
rows had more than one complete named book and all 56 had replayable same-book
opening/current movement. Mean absolute probability movement was 0.4046
percentage points and the maximum was 4.3761 points.

| Locked August 28–31 rows | FI v4 incumbent | FI v5 counterfactual |
| --- | ---: | ---: |
| Rows | 56 | 56 |
| Brier | 0.243037 | 0.244244 |
| Log loss | 0.679216 | 0.681629 |
| Exact-price Lean/Best actions | 25 | 24 |
| Record / units | 17-8 / +4.845u | 15-9 / +2.593u |
| Actionable promotions / demotions | — | 2 / 3 |

This short retained-history sample does not support an accuracy or profit
claim; its direction is reported explicitly and the missing earlier price
boards materially limit inference. The change is requirement-driven market
coherence, with future r77 performance evaluated separately by release ID and
lock timestamp. Existing locked FI-v4 payloads remain untouched.

## Regression coverage

- retail-only multi-book consensus without a sharp pair;
- one complete named book remains eligible;
- partial sharp inventory is neutral rather than a hold;
- synthetic split consensus cannot become price evidence;
- exact evaluation fair probability remains distinct from projection
  consensus and owns edge economics;
- same-book FI opening/current movement enters the posterior with a fixed 20%
  residual and one-point cap, while absent movement is neutral;
- expected first-inning runs and stored NRFI/YRFI probabilities invert the
  same final posterior at natural decimal precision;
- alternate 1.5-run FI rows, stale rows, invalid prices, and incoherent
  side timestamps are excluded;
- FI writer mappings, lock-sensitive pipeline assertions, and all non-FI
  release heads remain covered by the existing focused suites.

## Rollback

Restore FI probability head
`mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20`, schema v9,
calibration v28, decision r76, rule bundle v64, and grade policy v54 while
retaining the r76 full-game coherent price map and the stable-opening reader
repair. Do not modify or reconstruct locked r77 or earlier payloads.
