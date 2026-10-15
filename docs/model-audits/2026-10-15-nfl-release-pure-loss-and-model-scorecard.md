# NFL release-pure loss audit and model scorecard

Date: 2026-10-15

Status: completed SELECT-only audit; no new prediction behavior promoted by this report.

## Plain-language verdict

The injury/quarterback eligibility repair is live, but it is a safety repair rather than an
accuracy claim. It now refuses to publish an exact-price recommendation when the exact-game
injury report, expected quarterback, or selected quarterback history is unverifiable.

The model work did produce a real improvement. On the 32 immutable locks that stored the paid
independent team score, the independent score alone was 19-12-1 Moneyline, 8-22-2 Spread, and
15-17 Total. Replaying the current professional runtime on those exact same inputs produces
20-11-1, 17-13-2, and 20-12. The improvement comes from selective, target-book-excluded market
reconciliation, not from adding every available statistic or following every line move.

The remaining weak point is direct Spread. The current-runtime 17-13-2 result is 56.7% after
pushes and remains below the competitor's reported 59.7%. It clears the competitor only after a
six-point alternate line. Moneyline is essentially tied with the reported competitor on a much
smaller sample, and Total is ahead. No claim of competitor superiority is made because the games,
prices, timestamps, and sample sizes are not matched.

## Population boundaries

Three populations must remain separate:

1. **Immutable public history:** 79 games, 237 original market records, September 9 through
   October 12. It contains 16 decision/calibration tuples and must be reported as the actual public
   record, not relabeled as current-model performance. Nine append-only correction rows are
   excluded from the original-row cohort.
2. **Paid-score component cohort:** 32 games whose locked evidence stored the paid independent
   team score. This is the only valid population for independent-versus-market component claims.
3. **Current exact-price decision replay:** current eligibility rules leave only 14 of those 32
   historical games decision-complete. Its 42 evaluated markets and 54 truthful holds are useful
   for grade/economic diagnostics, but they are not a substitute for the 32-game projection
   scorecard.

## Immutable published record

| Market | Record | Accuracy |
| --- | ---: | ---: |
| Moneyline | 47-31-1 | 60.3% |
| Spread | 34-40-5 | 45.9% |
| Spread +3 | 42-36-1 | 53.8% |
| Spread +6 | 51-27-1 | 65.4% |
| Total | 43-35-1 | 55.1% |
| Total +3 | 47-32 | 59.5% |
| Total +6 | 53-25-1 | 67.9% |

The public actionable record is 54-47 with five pushes (53.5%). Historical Best Angles are
26-32 with two pushes (44.8%), while Leans are 28-15 with three pushes (65.1%). This is a warning
that the blended historical grade labels are not ordinally calibrated across releases. It is not
authority to invert the current grade policy; a current-policy replay is required for that.

## Competitor context

The competitor screenshot reports 64 Moneylines, 62 direct Spreads, 63 alternate Spreads, and 64
Totals. Those are different samples from the 79 OddSphere locks and do not include matched
timestamps or prices.

| Market | Competitor reported | OddSphere public history | Current runtime on paid-score cohort |
| --- | ---: | ---: | ---: |
| Moneyline | 41-23, 64.1% | 47-31-1, 60.3% | 20-11-1, 64.5% |
| Spread | 37-25, 59.7% | 34-40-5, 45.9% | 17-13-2, 56.7% |
| Spread +3 | 41-22, 65.1% | 42-36-1, 53.8% | 20-12, 62.5% |
| Spread +6 | 46-17, 73.0% | 51-27-1, 65.4% | 24-8, 75.0% |
| Total | 32-32, 50.0% | 43-35-1, 55.1% | 20-12, 62.5% |
| Total +3 | 36-28, 56.3% | 47-32, 59.5% | 21-11, 65.6% |
| Total +6 | 39-25, 60.9% | 53-25-1, 67.9% | 21-11, 65.6% |

Interpretation: current Moneyline is numerically 0.4 percentage points above the competitor,
Spread +6 is two points above, and all three current Total cuts are above. Direct Spread and
Spread +3 remain below. These are directional benchmarks only, not an apples-to-apples victory.

## What the components actually contribute

| Measure on the same 32 paid-score games | Independent only | Current professional runtime |
| --- | ---: | ---: |
| Moneyline | 19-12-1, 61.3% | 20-11-1, 64.5% |
| Spread | 8-22-2, 26.7% | 17-13-2, 56.7% |
| Spread +3 | 15-17, 46.9% | 20-12, 62.5% |
| Spread +6 | 19-13, 59.4% | 24-8, 75.0% |
| Total | 15-17, 46.9% | 20-12, 62.5% |
| Total +3 | 16-16, 50.0% | 21-11, 65.6% |
| Total +6 | 20-12, 62.5% | 21-11, 65.6% |
| Team-score MAE | 6.7161 | 6.5370 |
| Margin MAE | 10.0912 | 9.1453 |
| Total MAE | 9.8923 | 9.7430 |

Within the 42 markets that have a complete current decision tuple, the current runtime changes six
Spread sides versus independent and produces four corrections and one harm. It changes nine Total
sides and produces six corrections and two harms. Those decision-side counts are a narrower subset
than the 32-game direction scorecard above, so they must not be used to arithmetically explain every
win difference in that table. Moneyline gains one win through the joint score/market construction
without a direct current-decision side change in this replay. The current decision-complete subset
contains 23 actionables at 15-8 and +4.9829 units at stored exact prices, but 54 market slots are
now held under today's stricter personnel
requirements. That economic result is therefore descriptive, not a clean historical betting
backtest.

## What was wrong in the prior audit

`audit-nfl-2026-professional-market-reader.ts` previously read
`decision.evaluatedQuote.line` as a canonical home Spread. Production stores the line for the
selected team. An away `+3.5` therefore became a false home `+3.5` instead of the correct home
`-3.5` in retrospective settlement.

The published r29 `38-25-2` Spread claim is withdrawn. The correction adds a single canonical
selected-side-to-home-line conversion, a side-adjusted settlement helper, exact +3/+6 scoring,
and a regression test covering home, away, Spread, Total, push, and teased-line cases. Locked
payloads are not rewritten and production selection semantics are unchanged.

## Loss themes

There are 106 market losses in the immutable public cohort: 31 Moneyline, 40 Spread, and 35 Total.
Component attribution is mutually exclusive:

- 66 losses have no stored paid independent projection, so an honest independent-versus-market
  decomposition is impossible for those historical releases.
- 25 are losses where the stored independent and final forecast chose the same side.
- 13 are market-reader harms on the stored component comparison.
- 2 are market changes that remained losses or pushes under both sides.

The postgame explanation flags are multi-label and descriptive, not pregame causal features:

| Theme | Losses flagged |
| --- | ---: |
| Grade miscalibration | 47 |
| Distribution tail/scale error | 42 |
| Missing personnel evidence | 29 |
| Adverse turnover swing | 21 |
| Missed market anchor | 16 |
| Matchup-efficiency miss | 15 |
| Market-reader harm | 13 |
| Unresolved/irreducible | 13 |
| Finishing/scoreboard variance | 10 |
| Pass-protection/pressure miss | 7 |
| High pace/volume miss | 6 |
| Low pace/volume miss | 6 |

These flags explain why a result happened after kickoff. They may define future pregame feature
research, but they cannot be fed back as if they were known at lock.

## Statistics and probability handling

Across all 78 resolved historical Moneylines, the final model has 0.25336 Brier and 0.70121 log
loss versus 0.22841 and 0.64954 for target-excluded market consensus. The market favorite won
49 of 78. The historical final model called only four underdogs, one correctly, while 29 actual
upsets occurred. That blended probability history does not demonstrate value over the market.

On the same 32 paid-score locks, however, the current architecture improves every direction and
all three score-error measures versus paid independent-only. The correct conclusion is not “stats
are useless” or “trust the market.” It is:

- the paid score is a necessary football prior but is not accurate enough to own Spread or Total;
- market evidence is valuable only when book identity, line orientation, chronology, target-book
  exclusion, and cross-market coherence are preserved;
- public splits and generic all-book movement fail to produce stable chronological lift when used
  indiscriminately;
- richer EPA/success/pressure bundles, full-state replay, possession-efficiency, team-score
  residuals, and generic market-context residuals have already failed their confirmation gates;
- future statistics must enter as predeclared residual or uncertainty components and must improve
  a later chronological segment, not merely explain opened losses.

## Decision and next bounded target

No new coefficient or threshold is promoted from this opened audit. The injury/QB fail-closed gate
remains active, and the current selective professional reconciliation remains the best verified
architecture.

The next model target is direct Spread, not every market at once. A candidate must start from the
paid score, preserve the current target-excluded reader, and add one predeclared matchup-residual
or uncertainty component. It must reach at least 18-12 on the present 32-game diagnostic cohort,
confirm directionally on a later frozen segment, improve or preserve margin MAE and probability
quality, keep both promotions and demotions, and leave Moneyline/Total, score coherence, board
coverage, and personnel holds non-inferior. Anything that only removes losses, depends on
postgame flags, or flattens the board is rejected.

## Reproduction

- `scripts/operator/audit-nfl-2026-loss-ledger.ts`: immutable published scoreboard, alternates,
  probability quality, component attribution, score error, and complete loss ledger.
- `scripts/operator/audit-nfl-2026-reconciliation-tournament.ts --scorecard`: exact current-runtime
  independent/current/professional component and alternate-line replay.
- `scripts/operator/audit-nfl-2026-professional-market-reader.ts --qualified-candidate`: corrected
  historical market-reader audit with canonical Spread lines.
- `scripts/test-nfl-historical-settlement.ts`: focused settlement regression.

All audit queries are SELECT-only. No provider call, prediction write, grade write, snapshot write,
or locked-record mutation occurs.
