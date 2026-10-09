# NHL professional market-reader audit — result — 2026-10-09

## Decision status

Audit complete and owner-approved for production on October 9. The r17
implementation is prepared on the paired release branch; this document does
not claim that production is live until the protected merge and post-deploy
checks succeed.

The incumbent NHL Moneyline reader remains the selected winner/margin path.
The audit rejects a generic Moneyline or puck-line blend, rejects public-split
projection nudges, and identifies one production-eligible candidate: a
target-excluded exact-price Total reconciliation that preserves the incumbent
Moneyline probability and rebuilds one coherent score distribution.

Approved release, subject to the complete production safety process:

- model: `nhl_regular_2026_r17_target_excluded_total_reconciliation`
- calibration: `nhl_regular_calibration_2026_r17_target_excluded_total_reconciliation`
- decision: `nhl_regular_decision_2026_r17_target_excluded_total_reconciliation`

The predeclared benchmark is
[`2026-10-09-nhl-professional-market-reader-predeclaration.md`](./2026-10-09-nhl-professional-market-reader-predeclaration.md).
The SELECT-only replay is
[`audit-nhl-professional-market-reader-r17.ts`](../../scripts/operator/audit-nhl-professional-market-reader-r17.ts).

## Evidence integrity

The release-pure transition cohort contains 65 settled NHL games from September
29 through October 8, 2026. It contains 195 exact market decisions, 34,684
append-only line observations, immutable official scores, and complete locked
two-sided Moneyline, puck-line, and Total quote pairs for every game. Every
candidate uses only evidence captured no later than its own lock.

Chronology was fixed before candidate review:

- selection: first 45 games, through October 6;
- confirmation: later 20 games, beginning October 6.

The cohort is small and spans six transition releases. Each game's own frozen
independent and final projection is retained; releases are never blended and
described as one model's performance.

The split substrate has a material replay gap:

- Moneyline and Total percentages are frozen in all 65 prediction snapshots,
  but their observation timestamp and freshness are not frozen;
- spread splits are not frozen in the prediction snapshot;
- `public_splits_observations` is a mutable current-row upsert, not an
  append-only split history, so the present row cannot prove what value existed
  at T-60;
- no NHL `market_split_observations_v2` history exists for these locks.

The audit therefore does not use post-lock split rows, does not infer historical
spread splits, and does not let splits alter the proposed projection. This is
also consistent with the prior 589-game NHL study: adding public-split nudges
reduced confirmation Moneyline direction from 56.46% to 54.42%, and its learned
Total path reduced direction from 58.22% to 56.16%.

## What the incumbent actually does

The r16 score reader:

- uses a multi-book current Moneyline probability;
- reads only one selected book's first-to-current Moneyline and Total endpoint;
- can flip a winner only when a 54% market side, at least two books, a 1-point
  same-book move, and aligned 55% tickets and money all agree;
- preserves the independent Total on a Moneyline flip;
- adjusts the Total by only 35% of a same-book line move, capped at 0.25 goals;
- does not reconcile the current Moneyline and puck price boards into the
  margin distribution;
- does not use puck-line history as a projection input;
- does not consume the complete observed path even when that path is stored.

It nevertheless remains coherent: all 65 stored final picks agree with their
stored final score distributions. Its two discrete Moneyline flips corrected
two independent misses and harmed zero games.

## Moneyline and puck-line conclusion

More Moneyline authority is not supported.

- Incumbent Moneyline: 41-24, 63.08%.
- Independent Moneyline: 39-26, 60.00%.
- Target-excluded current-price Moneyline side: 37-28, 56.92%; when it opposed
  the incumbent it made five corrections and nine harms, net minus four.
- A joint Moneyline-plus-puck market-implied winner was also 41-24, but its 12
  disagreements were six corrections and six harms, net zero.
- Stable named/broad Moneyline sequence evidence did not validate an additional
  flip rule in the later segment.
- Strong current-price Moneyline disagreements also failed: one correction and
  two harms over the complete cohort.

The correct production action is therefore to preserve the current discrete
corroborated winner-flip path. It already catches qualified upsets without
turning every market disagreement into a flip. Moneyline and puck-line prices
remain jointly useful for distribution diagnostics, disagreement, and future
evidence capture; this cohort does not authorize a new winner rule.

The proposed Total reconciliation preserves the incumbent Moneyline probability.
Solving the goal margin again after changing the Total keeps winner probability
and Moneyline calibration identical, while allowing puck-line probability and,
when the coherent distribution truly crosses 50%, puck side to react.

## Selected Total reconciliation

For each exact evaluated Total:

1. Keep only complete over/under quote pairs at the exact line.
2. Exclude the evaluated sportsbook family from the evidence board.
3. Require at least two remaining complete sportsbook families. A one-book
   remainder is unavailable, not consensus.
4. De-vig each pair and use the cross-book median Over probability. Both line
   and price therefore matter; a flat 6.5 with juice movement is not zero
   movement.
5. Solve the Poisson Total mean whose push-excluded Over probability equals the
   target-excluded market probability.
6. Give the target full authority when a named-book pair is present and 80%
   authority when only broad retail confirmation exists. If a stable named or
   broad full sequence moves against the endpoint, multiply authority by 0.65.
   Missing sequence is neutral. Public splits never add authority.
7. Re-solve the goal margin so the incumbent Moneyline probability is retained.
8. Rebuild the one joint distribution and derive Moneyline, puck-line, Total,
   probabilities, score, and grades from it. An economically neutral 50/50 Total
   preserves the incumbent side rather than producing a floating-point flip.

The production-parity pass closes the circular target-book edge case: if the
Total side changes and the best evaluated price moves to another sportsbook,
the read is recomputed excluding that final sportsbook. The side/book pair must
reach a fixed point; a cycle or incomplete remainder fails closed to the
incumbent forecast. The results below include this final safeguard.

These are evidence-quality requirements and continuous reconciliation, not one
arbitrary flip threshold. The Total may move substantially when the complete
price board implies it should.

## Chronological results

### Selection — 45 games

| Metric | incumbent | candidate |
| --- | ---: | ---: |
| Total record | 21-23-1 | **22-22-1** |
| Total accuracy | 47.73% | **50.00%** |
| Total Brier | 0.27088 | **0.26338** |
| Total log loss | 0.73808 | **0.72139** |
| Exact-price units, all Total sides | -4.75u | **-3.13u** |
| Total corrections / harms | — | **2 / 1** |
| Total net side corrections | — | **+1** |
| Coherent puck correction / harm | — | **1 / 0** |
| Team-score MAE | 1.61033 | **1.59991** |
| Margin MAE | 2.27887 | **2.27756** |
| Total MAE | **2.03584** | 2.05233 |

The candidate pays a 0.016-goal Total-MAE tradeoff in selection while improving
Total direction, calibration, return, team-score MAE, and margin MAE. The one
coherent puck correction keeps the full selection net at plus two.

### Later confirmation — 20 games

| Metric | incumbent | candidate |
| --- | ---: | ---: |
| Total record | 6-14 | **9-11** |
| Total accuracy | 30.00% | **45.00%** |
| Total Brier | 0.31334 | **0.26416** |
| Total log loss | 0.82562 | **0.72186** |
| Exact-price units, all Total sides | -7.86u | **-2.37u** |
| Total corrections / harms | — | **4 / 1** |
| Net side corrections | — | **+3** |
| Team-score MAE | 1.38469 | **1.33064** |
| Margin MAE | 2.21885 | **2.20838** |
| Total MAE | 1.95629 | **1.64864** |

### Complete 65-game audit

| Metric | incumbent | candidate |
| --- | ---: | ---: |
| Moneyline | **41-24** | **41-24** |
| Moneyline Brier | **0.223523** | **0.223523** |
| puck line | 36-29 | **37-28** |
| Total | 27-37-1 | **31-33-1** |
| Total accuracy | 42.19% | **48.44%** |
| Total Brier | 0.28415 | **0.26362** |
| Total log loss | 0.76544 | **0.72154** |
| Exact-price units, all Total sides | -12.61u | **-5.49u** |
| Total side changes | — | 8 |
| Total corrections / harms | — | **6 / 2** |
| Total net side corrections | — | **+4** |
| puck side changes / corrections / harms | — | **1 / 1 / 0** |
| Combined net side corrections | — | **+5** |
| Team-score MAE | 1.54090 | **1.51706** |
| Margin MAE | 2.26040 | **2.25628** |
| Total MAE | 2.01136 | **1.92811** |
| Upset recall | 29.63% | 29.63% |

The puck-side change is the coherent consequence of preserving winner
probability while changing the event-rate distribution; it corrects one loss
without a harm. Moneyline side, probability, calibration, exact-price return,
and upset recall remain unchanged.

## Loss review

Every incumbent loss was reviewed at its lock.

- Moneyline: 18 losses were also on the losing market-consensus side; five had
  opposing market price evidence, but the broader rule that would follow those
  signals produced more harms than corrections; one was mixed. No additional
  qualified Moneyline correction survived.
- puck line: the coherent Total candidate corrected one incumbent loss without
  causing an offsetting side harm. Other losses either had no qualified Total
  read or did not cross the coherent puck boundary.
- Total: the candidate corrected six incumbent losses. Remaining losses were
  either also market-consensus misses or had disagreement insufficient to cross
  the coherent final boundary.

This is not a claim that the market predicts every game. The retained harms are
WPG-DET and FLA-LAK: both complete, target-excluded Total boards supported Over,
but the games finished Under. They are real false market reads and remain in the
reported denominator.

## Grade and board utility

Applying the same current r16 grade policy before and after the score change:

- full cohort: 149 to 137 actionables, six promotions and 20 demotions;
- actionable hit rate: 53.38% to **55.88%**;
- actionable exact-price return: -11.26u to **-5.27u**;
- later confirmation: 40 to 40 actionables, four promotions and five demotions;
- later actionable hit rate: 50.00% to **57.50%**;
- later actionable return: -4.15u to **+1.06u**.

The board becomes more selective but is not flat: 137 of 195 historical market
slots remain actionable. Promotions and demotions come from the same symmetric
score/probability/price rules; there is no quota and no demotion-only override.

## October 9 current-board replay

The exact current r16 board contains four games, 12 markets, and ten actionables.
The candidate produces nine actionables, one side change, one grade change, and
no Moneyline side or Moneyline-grade change.

| Game | incumbent score (away-home) | candidate score (away-home) | material change |
| --- | ---: | ---: | --- |
| NYR @ WSH | 3.40-3.03 | 3.07-2.73 | score/probabilities only; picks and grades unchanged |
| PIT @ CBJ | 2.49-3.31 | 2.96-3.85 | **Under 6.5 -> Over 6.5**; Lean remains Lean |
| SEA @ DET | 2.26-3.46 | 2.53-3.80 | score/probabilities only; DET Best Angle preserved |
| ANA @ WPG | 3.33-2.93 | 3.48-3.08 | Under 6.5 Lean -> Watchlist; side unchanged |

For PIT-CBJ, the target-excluded Total board contains 19 complete books,
including two named books. Its median Over probability is 52.17%; removing each
book in turn leaves the Over side unchanged (52.17% in the final captured
board). The side change
is therefore not caused by one book, one split, or one hard threshold.

Current grade distribution moves from one Best Angle / nine Leans / two
Watchlists to one Best Angle / eight Leans / three Watchlists. The board remains
fully populated and 75% actionable.

## Remaining substrate repairs

The candidate works without splits today. The production implementation closes
the audit's target-exclusion provenance gap by freezing the excluded family,
included families, exact line, median probability, book counts, and stable
sequence decision in the prediction snapshot. Remaining capture work is:

1. append-only, timestamped split observations rather than a single mutable
   current row;
2. frozen spread-split values, source, confidence, and observation timestamp;
3. explicit full-sequence leader/follower, reversal, persistence, and buyback
   fields so future audits do not have to reconstruct them from raw rows.

These repairs do not authorize split projection influence. They make future
decisions replayable.

## Production gate

The approved implementation must:

1. advance the complete r17 model/calibration/decision and registry family;
2. retain the sole NHL writer and `prediction_pipeline:nhl` lease;
3. preserve every existing locked record byte-for-byte;
4. store the candidate evidence and reconciliation state for future locks;
5. add focused tests for target-book exclusion, two-book minimum, exact-line
   pairing, no-split operation, missing named books, sequence opposition,
   neutral 50/50 behavior, winner-probability preservation, puck/Total/score
   coherence, writer immutability, and reader precedence;
6. rerun the SELECT-only replay and exact current-board comparison;
7. run the focused NHL suite, `npm run verify:model-change`, TypeScript, and
   integration-safety verification from a clean branch based on current main;
8. publish by protected pull request only, then verify the live r17 release,
   natural update cycle, one writer/lease, data coverage, score/pick/grade
   coherence, member page, and rollback path.

Until those steps and owner approval are complete, r16 remains live.
