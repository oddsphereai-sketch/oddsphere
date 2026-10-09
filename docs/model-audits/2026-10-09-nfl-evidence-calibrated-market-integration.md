# NFL evidence-calibrated market integration result

Status: rejected after three diagnostic rounds; no production behavior or release identifier changed.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

Paired predeclaration:
`docs/model-audits/2026-10-09-nfl-evidence-calibrated-market-integration-predeclaration.md`.

## Decision

Do not publish any October 9 candidate. The active release remains the r27 named-sequence family. The
attempted r28 identifiers were never published and are not an immutable-lock predecessor.

The initial candidate described below was rejected when the zero-write current board fell from 19
actionables to two, taking both Spread and Total to zero. R2 corrected the identity of same-book movement
but produced three settled Spread corrections and four harms when combined with the candidate. R3 stopped
ordinary near-50/50 price noise from originating a Spread direction; its final opened diagnostic was
Moneyline 11-7, Spread 8-9-1, and Total 11-7 versus stored 9-9, 9-8-1, and 11-7. Its current board still
contained only two actionables, with one promotion, 25 grade demotions, and a net loss of 17 actionables.
It therefore fails both predictive and anti-flat-board gates.

The remainder of this document preserves the initial candidate evidence as an audit record; references
to advancing it are superseded by this final decision. The controlling implementation and gap inventory
is `2026-10-09-nfl-sharp-market-reading-adapter.md`.

## Initial candidate retained for diagnostic history

The first predeclared candidate tested two proposed integration corrections without changing the paid
independent score, market-direction hierarchy, provider cadence, T-60 lock, stakes, copy, labels, or layout:

1. A contrary Spread or Total read no longer inherits the independent model's confidence on the
   opposite side. Direction can still move and flip the shared projected score, but confidence at the
   moved line comes from the target-excluded current no-vig price. A confirming read may retain the
   stronger independent probability. This retains a tested promotion path and removes unsupported
   reflected conviction.
2. A Spread-driven same-winner margin expansion is limited to 1.5 points unless existing Moneyline
   movement plus a qualifying split, or matching qualified Moneyline and Spread named sequences,
   corroborates the larger expansion. Winner-crossing authorization and sharp opposition veto remain
   unchanged.

The candidate keeps one joint score distribution authoritative for expected score, representative
score, Moneyline, Spread, Total, probabilities, and exact-price grades. Existing locked payloads are
read unchanged.

## What the released system did versus the candidate

The SELECT-only replay used the exact stored 2026 Week 3-5 paid-score payloads, their immutable stored
decisions and prices, and only evidence captured no later than each stored timestamp. It contains 18
games; four have complete named sharp split sets. This is opened retrospective evidence, not a pristine
holdout.

| Measure | Stored release | Candidate |
| --- | ---: | ---: |
| Moneyline projection | 9-9 | 11-7 |
| Spread projection | 9-8-1 | 11-6-1 |
| Total projection | 11-7 | 11-7 |
| Moneyline evaluated decisions | 9-8 | 11-6 |
| Spread evaluated decisions | 8-7-2 | 10-5-2 |
| Total evaluated decisions | 10-7 | 9-8 |
| Moneyline Brier / log loss | 0.25905 / 0.71074 | 0.22586 / 0.64010 |
| Spread Brier / log loss | 0.26780 / 0.72996 | 0.23498 / 0.66261 |
| Total Brier / log loss | 0.26325 / 0.72053 | 0.25028 / 0.69375 |
| Moneyline stored-price units | -3.7066 | +0.6964 |
| Spread stored-price units | +0.7037 | +4.6005 |
| Total stored-price units | +2.2020 | +0.2929 |
| Team / margin / Total MAE | 6.5797 / 9.6681 / 10.0353 | 6.1109 / 8.6392 / 9.5477 |
| Upsets predicted / caught | 2 / 1 of 9 | 4 / 3 of 9 |
| Upset precision / recall | 50.0% / 11.1% | 75.0% / 33.3% |

The candidate changes four Moneyline sides (three corrections, one harm), five Spread sides (three
corrections, one harm, one push unchanged), and two Total sides (zero corrections, one harm, one result
unchanged by a different evaluated line). It demotes two historical Moneyline actionables, three Spread
actionables, and eight Total actionables; it promotes none in this small cohort. The tested confirming-
price promotion path exists, but no stored row satisfies it.

Historical actionable results move as follows:

- Moneyline: 2-4 on six actionables to 3-1 on four.
- Spread: 1-4 on five actionables to 2-0 on two.
- Total: 7-5 on twelve actionables to 3-1 on four.

All four stored losing Total Best Angles are demoted. Three winning Total Best Angles and two winning
Total Leans are also demoted; this is a precision/coverage tradeoff, not a claim that every demotion was
necessary in hindsight. The sole Total side harm is Green Bay-Tampa Bay: the stored Under won while the
candidate's price-coherent Over lost. Total raw side accuracy therefore does not improve, even though
its probability calibration and actionable precision do.

The Detroit-Carolina failure is materially corrected. The stored release expanded Detroit from the
independent Detroit-by-1.21 opinion to Detroit by 7.75 without Moneyline corroboration, creating losing
Moneyline and Spread Best Angles. The candidate bounds the score at Detroit by 2.71, demotes the losing
Moneyline to No Play, changes the Spread to winning Carolina +4, and demotes it to Watchlist.

## Current-board zero-write impact

The latest Week 5 member snapshot contains 15 games and 45 evaluated markets. No row was written or
locked by the audit.

| Market | Stored actionable | Candidate actionable |
| --- | ---: | ---: |
| Moneyline | 7 | 2 |
| Spread | 5 | 0 |
| Total | 7 | 0 |
| All markets | 19 | 2 |

Stored grades are 15 Best Angles, four Leans, twelve Watchlists, and fourteen No Plays. Candidate grades
are two Leans, twelve Watchlists, and 31 No Plays. There are zero actionable promotions and seventeen
actionable demotions. Across every grade transition, including Watchlist/No Play movement, there are
25 demotions and zero promotions. This large contraction is disclosed explicitly and is why owner
approval would have been required; the candidate is now rejected regardless.

The contraction is not caused by a new display filter or higher grade threshold. It comes from removing
probability that the old integrator transferred from the independent side to the opposite market side,
plus bounding unsupported Moneyline margin inflation. Market evidence still moves and can flip the
projected score. A current bet becomes actionable only when the final joint probability also beats its
exact available price under the unchanged grade policy.

## Signal audit and limitations

The broader 32-game Weeks 3-4 sequence audit prevents a generic interpretation of every input as
"sharp money":

- selected-book Spread movement was 17-14-1;
- selected-book Total movement was 10-4 but was concentrated in Week 4;
- named lead/follow qualification was 3-0 Moneyline, 4-2 Spread, and 2-1 Total, with very small coverage;
- raw public money-minus-ticket gaps were 0-4 Moneyline, 3-3 Spread, and 6-5 Total and were unstable by week;
- named sharp money-minus-ticket gaps were 2-3 Moneyline, 3-1 Spread, and 2-0 Total, also with small coverage.

Therefore splits remain corroboration or veto evidence, not standalone confidence. The candidate does
not claim that a final-hour move is inherently predictive, and it does not require one because the
product locks at T-60. It evaluates only the chronological evidence available by the lock timestamp.

The 18-game exact paid cohort is too small to guarantee future performance, estimate narrow confidence
intervals, or prove the observed units will persist. The current-board contraction is real and must not
be hidden behind the better retrospective hit rates.

## Verification

Passed focused tests:

- `scripts/test-nfl-v1-actionable-grade-candidate.ts`
- `scripts/test-nfl-named-market-sequence.ts`
- `scripts/test-nfl-forward-member-snapshot.ts`
- `scripts/test-nfl-forward-evidence-writer.ts`
- `scripts/test-nfl-r6-shadow-writer.ts`
- `scripts/test-nfl-week-one-held-member-fixture.ts`

The final documentation-and-audit state passes `npm run verify:model-change`. Candidate runtime edits and
release bumps were removed, so there is no r28 runtime family to publish or roll back. No production write,
deployment, or locked-record mutation occurred. Never recompute or relabel a legacy locked row.
