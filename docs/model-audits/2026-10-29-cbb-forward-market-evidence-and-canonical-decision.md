# Private CBB forward evidence and canonical decision audit

Status: **no CBB activation or predictive promotion**. The live Daily Edge,
prediction writer, grades, stakes, locks, and tracking are unchanged. This audit
uses the existing private prelaunch worktree and local provider receipts.

## Corrected decision comparison

The older `evaluate-cbb-market-reader.ts` scored Spread selections using the
sign of projected margin plus line. That is not the same as the product's
discrete/no-tie `reviewCbbQuote` decision. The operator now calls that canonical
decision function for Moneyline, Spread, and Total and writes newly suffixed
receipts; the old sign-based report is preserved, not silently reinterpreted.

On its already-opened February 2026 selection block of 162 exact-game,
three-market opening quotes, frozen r2 won 117 Moneylines, 96 Spreads, and 79
Totals. The three opening-price reader ridge settings changed those wins by:

| Ridge penalty | Moneyline | Spread | Total | Combined net |
| ---: | ---: | ---: | ---: | ---: |
| 10 | -1 | -11 | -6 | -18 |
| 100 | -2 | -7 | -1 | -10 |
| 1000 | -1 | -3 | +1 | -3 |

None meets the existing joint selection rule. The 40-game later block was not
opened for a selected candidate because none qualified. The corrected local
report is `market-reader-evaluation-report-canonical-decision-20261029.json`
under `/private/tmp/oddsphere-cbb-data/`. These quotes are archived openings,
not contemporaneously receipted live movement or sharp splits. This corrected
run is diagnostic, not fresh holdout confirmation.

## What can actually be observed before the new season

A bounded current Owls NCAAB odds/splits probe on October 29 at about 16:28 UTC
created a new immutable local odds receipt alongside three earlier snapshots.
The read-only `audit-cbb-forward-price-paths.ts` normalizes exact named teams,
start times, two-sided prices, provider-update times, and local receipt times;
it reports distinct same-book states without calling the first observation a
true opener.

In the seven-day BallDontLie schedule window, 150 upcoming Division I games
were listed and **seven** had exact matched, complete named-book Moneyline,
Spread, and Total quotes across the four available snapshots. Six of those
seven had at least one observed retail price or line change. For example,
FanDuel's Villanova–Notre Dame Total changed from 148.5 to 147.5, with both
prices retained. This is an observed path, **not** a finding that the move
predicts the result. None of the seven had a current complete Pinnacle/Circa
pair in this response. The separate splits response reported zero games,
`partial: book_unavailable`.

A read-only production count found **zero** canonical `games` rows with sport
`cbb` (including November 1–3). The existing shared market-observation
collector selects its slate from that table, so it cannot accumulate the CBB
path there while the prelaunch sport remains absent. The private local receipts
are therefore the actual available path evidence, not proof of shared capture
or a qualified sharp reader. No production fixtures were inserted to solve a
private-research problem.

## Interpretation and next gate

The same-day evidence confirms the joined diagnosis: (1) a previously
noncanonical evaluator could make a reader appear better or worse for the wrong
reason; (2) correcting that evaluator still does not make the opening-only
reader improve all three markets; (3) actual forward retail movement can be
captured, but current sharp-book and split coverage is absent; and (4) the
shared collector is not building CBB history because the sport is unpublished.
This is a measurement-and-input gap, not proof that following every move wins.

Before any reader gains predictive authority, freeze one decision time and
target-book rule, retain UTC provider and receipt clocks, and compare r2,
opening-only, and path-aware coherent score forecasts on later untouched games
with the same exact Moneyline, Spread, and Total quotes. Report corrected losses,
harmful flips, W/L/push, conditional probability quality, price outcomes, score
error, and date-level uncertainty. No grades or stakes are proposed here.

Reproduce without provider calls or production writes:

```sh
node --import tsx scripts/operator/evaluate-cbb-market-reader.ts
node --import tsx scripts/operator/audit-cbb-forward-price-paths.ts
node --import tsx scripts/test-cbb-market-reader.ts
```
