# NHL source-aware market trust r9 — 2026-09-29

## Decision

Release `nhl_regular_2026_r9_source_aware_market_read`, calibration
`nhl_regular_calibration_2026_r9_source_aware_market_read`, and decision
`nhl_regular_decision_2026_r9_source_aware_exact_price`.

R9 retains the r8 independent score model, opponent-adjusted Total, bounded 20%
Moneyline no-vig price sanity input, named same-book movement, exact-price
decision rules, and one coherent final score. It removes Playbook/legacy
SharpAPI public-consensus money-minus-ticket nudges from the score equation.
Those observations remain stored, silently carried forward, source-separated,
and visible through the existing member surface. No copy, labels, layout,
provider calls, cadence, writer, lease, thresholds, or stakes change.

## Why source trust changed

Public splits, a no-vig price, and named same-book movement are different
evidence. Playbook supplies multi-book public ticket/handle consensus. It is not
a Circa or Pinnacle quote trail and cannot establish steam, reverse-line
movement, or price discovery by a leader book. The NHL feature path already
selects continuous same-book movement in priority order Circa, Pinnacle,
Bookmaker, then another complete book. R9 keeps that path intact and prevents
public consensus from impersonating it.

Published research supports conditional rather than universal trust: informed
traders can improve opening prices, but high-frequency odds changes can
overreact or reverse; information effects vary with timing, leader/follower
behavior, news, market, and regime. NHL Moneyline and Total studies likewise
find context-dependent efficiency and bias rather than a universal rule that
every move or public handle imbalance should be followed.

References:

- <https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2022.00456>
- <https://www.sciencedirect.com/science/article/abs/pii/S0148619513000295>
- <https://onlinelibrary.wiley.com/doi/pdf/10.1111/0022-1082.155346>
- <https://ideas.repec.org/a/sae/jospec/v5y2004i2p152-168.html>
- <https://ideas.repec.org/a/ebl/ecbull/eb-10-00729.html>

## Current-era chronological evidence

The audit recovered 591 frozen pregame NHL split rows from Playbook
`/v1/splits-history`; 589 joined unambiguously to official BALLDONTLIE games,
openers, and release-parity forecasts from January 5 through April 16, 2026.
The UTC-date contract was reconciled to the official hockey date by exact
home/away identity within one day. Two rows remained unmatched and were
excluded rather than guessed.

Pregame independent features were built only from earlier games. Official
scores restored shootout-deciding goals before evaluation. Calendar-ordered
windows contained 317 development games, 125 tuning games beginning March 12,
and 147 confirmation games beginning March 28. Candidate selection never used
the final window.

### Moneyline confirmation

| path | n | winner accuracy | Brier | log loss |
| --- | ---: | ---: | ---: | ---: |
| independent | 147 | 55.78% | 0.234771 | 0.661079 |
| opening market | 147 | 55.10% | 0.236832 | 0.666346 |
| 20% price sanity, no public-split nudge | 147 | **56.46%** | 0.234497 | 0.660799 |
| r8 path including public-split nudge | 147 | 54.42% | **0.234482** | **0.660695** |
| selected conditional learned path | 147 | 55.78% | 0.238317 | 0.669467 |

The public-split nudge changed enough near-coin-flip games to lose three net
winner directions versus the price-sanity path. Its tiny Brier/log-loss gain
did not compensate for the direction loss, and a more flexible conditional
model worsened both calibration scores. The learned candidate is rejected.

Money-minus-ticket direction was unstable: 55.52% in development, 48.80% in
tuning, and 56.03% in confirmation at a three-point gap. At a five-point gap it
was 58.21%, 41.82%, then 57.69%. This is not a stable score nudge or side-flip
rule.

### Total confirmation

| path | non-push n | direction | total MAE |
| --- | ---: | ---: | ---: |
| independent | 146 | **58.22%** | 2.0418 |
| opening market | 146 | 45.21% | 2.1020 |
| r8 bounded public-split nudge | 146 | **58.22%** | 2.0389 |
| selected conditional learned path | 146 | 56.16% | **2.0150** |

The bounded public split did not change confirmation direction and its 0.0029-
goal MAE difference is not a meaningful or stable reason to retain a source-
misclassified projection input. The learned model slightly reduced MAE but
worsened the betting direction that the Total decision consumes. It is rejected.

## Movement boundary

The older SBR open/close archive remains directionally informative but does not
authorize unconditional flips. A five-percentage-point Moneyline move was
57.83% directional on 2017–21 confirmation; the selected flip rule corrected
40 games and worsened 40. Total movement was unstable. R9 therefore retains
bounded same-book movement and does not add a broad flip rule.

Full intraday current-era Circa/Pinnacle history is not present in the recovered
split archive. No result here is described as validation of steam velocity or
RLM. Those behaviors require chronological observations from the same named
book and line and must be evaluated from append-only captures rather than
synthesized from public splits.

## Board, transition, and rollback gates

The exact r8/r9 board comparison at the same stored state retained 5/5 games,
15/15 markets, 10/10 actionables, ten Leans, and five Watchlists: zero side
changes, zero promotions, and zero demotions. Four Moneylines, two Totals, and
four puck lines remained actionable. The release therefore does not flatten or
inflate the current board. Locked r7 rows remain immutable and tracking-
eligible; no r8 row was published to production. The reader advances to
`nhl_daily_edge_reader_2026_09_29_r5_source_aware_transition` and selects r9 for
unlocked/future rows while retaining valid locked r7 tuples.

Publication requires the focused NHL test, TypeScript, model-change verification,
latest-main integration safety, protected PR checks, and live proof of r9
release IDs, complete two-sided prices, split continuity, lock immutability,
tracking eligibility, and zero score/side contradictions. Hold or roll back
unlocked r9 output on coverage loss, unexpected board collapse, mixed current
releases, coherence failure, writer overlap, or reader/lock failure.
