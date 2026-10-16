# MLB unified game distribution r92 predeclaration

Date: 2026-10-16
Starting production base: `73b1f51e84f5b448c1567856ad3fe6a742e6aaaf`
Status: implementation candidate; no live behavior is authorized unless every gate below passes

## Owner objective

MLB must publish one logical game forecast. Moneyline, Total, run line, alternate lines, displayed
scores, market arbitration, and public grades must be views of that forecast rather than unrelated
post-hoc models. The market reader remains part of the final decision, but it may not create a
second contradictory score world.

## Frozen candidate

This release carries forward the already-opened 2026 foundational audit. It is not an untouched
holdout claim.

1. Preserve the current r91 Moneyline margin axis and Moneyline market-reader path.
2. Repair only the independent Total axis when all pregame conditions are true:
   - data-quality tier is `high`;
   - both starter season ERAs are present and their average is below `4.75`;
   - both opposing-bullpen factors are present and their average is below `1.05`.
3. In the repair scope, replace the product of full-game starter and bullpen factors with their
   expected-innings-weighted arithmetic blend. Recompose expected home/away runs from the repaired
   Total and the incumbent margin.
4. Use the frozen development-only Total score-gap calibration:
   `P(over) = logistic(0.096289 * (expected_total - listed_total))`.
5. Keep target-excluded market evidence as a downstream reader, exact-price evaluator, and
   corroborated-opposition arbiter. It may update the shared Total axis only when the existing r90
   evidence contract qualifies; any update must regenerate the single displayed score pair while
   preserving the margin axis.
6. Derive Moneyline and run-line probabilities from the same preserved margin distribution and
   derive Total/alternate-Total probabilities from the repaired Total distribution. The released
   forecast explicitly owns both axes and the one expected score pair they imply.
7. Apply the frozen two-layer Total action contract only after the final reader result has a real
   offered quote:
   - model probability at least `0.51`;
   - absolute final projection gap at least `0.5` runs;
   - offered edge nonnegative;
   - price no worse than `-150`;
   - statistical Best Angle -> public Best Angle;
   - statistical Market Aligned -> public Lean;
   - all other statistical grades -> Watchlist.

No threshold may be retuned on validation, chronological confirmation, or current-board outcomes.

## Required coherence invariants

- There is exactly one final expected Total, margin, home score, and away score per game.
- `home_score + away_score == expected_total` within numeric tolerance.
- `home_score - away_score == expected_margin` within numeric tolerance.
- The Moneyline selected side agrees with the margin distribution.
- Favorite `-1.5` cover probability cannot exceed favorite win probability.
- Underdog `+1.5` cover probability cannot be lower than underdog win probability.
- Favorable alternate-line probability is monotone as the line improves.
- Over probability is monotone nonincreasing as the listed Total rises.
- A Total-only repair cannot change the Moneyline side, probability, confidence, grade, action,
  exact quote, or stake.
- Locked records render their stored legacy payload first and are never rewritten or reinterpreted.

Any failed invariant makes the future unlocked game a fail-closed non-actionable candidate; it may
not silently fall back to a contradictory per-market tuple.

## Historical gates

The exact frozen-evidence writer replay must reproduce or improve the already-recorded Candidate C
results on 1,180 games:

- final Totals: at least `622-551-7` (53.03%) and at least `+25.15u`;
- no Moneyline side changes and no Moneyline grade/action changes;
- favorable Total `+1` at least 60.99% and favorable Total `+2` at least 70.52%;
- final two-layer action board: 177 rows, at least 58.19%, at least `+21.84u`;
- Best Angles: 46 rows, at least 63.04%, at least `+9.74u`;
- actionable results and units positive in development, opened validation, and chronological
  confirmation;
- promotions and demotions are reported explicitly; board contraction cannot be hidden.

The Moneyline baseline must remain the exact current-writer record of `770-571`, with 499
actionables at `310-189` and 148 Best Angles at `101-47` on the audit cohort.

Run line remains shadow-only. The current historical evidence does not authorize a public run-line
release. It must be derived and captured from the unified forecast, but cannot become an official
pick until immutable release-separated forward evidence beats the paired market and closes the
main/+1/+2 benchmark gaps.

## Publication gates

- Bump all affected MLB projection, distribution, Total probability, calibration, decision, rule,
  grade, and correction identifiers in the machine registry and release registry.
- Future unlocked rows only; locked writer and reader precedence tests must pass.
- One authoritative writer and the existing `prediction_pipeline:mlb` lease remain unchanged.
- Focused MLB tests, cross-market invariant tests, TypeScript, lint, and
  `npm run verify:model-change` pass.
- Re-run the full exact writer replay and current-board no-write rehearsal from the committed tree.
- Rebase/integrate onto the latest `origin/main`, run integration safety, publish through a
  protected pull request, and verify the live release identifier and board after merge.

If any historical gate fails, the implementation remains shadow-only. No weaker partial Total
bolt-on is an acceptable substitute for this unified contract.
