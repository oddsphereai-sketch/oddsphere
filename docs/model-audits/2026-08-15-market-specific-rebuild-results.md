# Market-specific rebuild results — 2026-08-15

## Decision

The current slump is not one failure shared by every market. The fresh audit
found three distinct conditions:

1. MLB moneyline, MLB total, WNBA total, and WNBA spread probabilities require
   rebuild or shadow work because the incumbent failed an uninformed-probability
   baseline in the full sample, the locked final period, or both.
2. MLB first inning and WNBA moneyline probabilities retain measurable skill,
   but their actionable layers do not reliably convert that skill into
   price-adjusted bets.
3. No replacement action policy or flip passed every validation, locked-final,
   bootstrap, best-day-removal, and balanced-board gate. No live prediction,
   side, grade, stake, or actionability rule is changed by this release.

The safe production change is evidence capture, not a speculative betting rule.
New WNBA records now freeze the selected record price, exact-line opposite
price, and same-book no-vig market probability under
`wnba_prediction_record_contract_v3_paired_market_snapshot_2026_08_15`.
Historical locked records are unchanged.

## Fresh evaluation

No candidate, threshold, or conclusion from an earlier research report was
imported. The audit reads immutable locked prediction records and settled
outcomes, uses mechanical chronological development/calibration/validation/final
partitions, and evaluates four small regularized candidate families at four
regularization values. It also performs four rolling-origin checks.

Actionability evaluates both the frozen original side and a separately priced
opposite side at five EV margins. An opposite-side action uses `1 - p`, the
paired opposite price from the same locked snapshot, and the inverted binary
outcome. It must have at least 20 validation observations across ten dates and
pass the same profitability and robustness requirements as an original-side
action. A losing original cohort is never sufficient reason to flip it.

The final partition is locked but not discovery-blind because recent aggregate
results were already known when this rebuild began. Consequently, a passing
candidate can enter forward shadow only; it cannot become a live champion from
this audit alone.

The specific-instance flip search then evaluated fixed odds bands,
model-versus-market gaps, ticket bands, money-versus-ticket gaps, movement
bands, diagnosis states, sides, and six predeclared two-way interaction
families. MLB moneyline tested 500 cohort/margin hypotheses, MLB total 485, and
MLB first inning 155; none reached the minimum 20 validation actions across ten
dates. WNBA tested 140/35/70 hypotheses for moneyline/total/spread, but no
historical WNBA row had a locked opposite execution price, so none was
eligible. There is therefore no validated specific flip yet—not because flips
were treated as blanket changes, but because no odds/split/movement cohort had
enough independently priced validation evidence. The new WNBA capture contract
is what makes that question testable prospectively.

## Market-by-market answer

| Market | Incumbent probability evidence | Actionable evidence | Probability disposition | Market/action disposition |
|---|---|---|---|---|
| MLB moneyline | 494-377, Brier .2455 overall; final 77-71, Brier .2537 and log loss .7006, both worse than 50/50 and worse than the paired market | 174-140, -7.236u overall; final current actions 18-19, -6.129u | Rebuild required | Market diagnosis and actionability rebuild required |
| MLB total | 440-414, Brier .2516 overall; final Brier .2544, both worse than 50/50 | 172-174, -17.589u; Under actions 72-83, -18.044u | Rebuild required | Market diagnosis and actionability rebuild required |
| MLB first inning | 338-252, Brier .2451, +22.861u; final Brier .2399 and log loss .6725 | 178-138, +12.383u overall, but final current actions 48-42, -3.800u | Retain incumbent probability | Market evidence insufficient; actionability rebuild required |
| WNBA moneyline | 88-40, Brier .2070; final 17-3, Brier .1285 | 27-19, -4.383u; away actions 8-10, -6.260u versus home 19-9, +1.877u | Retain incumbent probability | Market evidence insufficient; actionability rebuild required |
| WNBA total | 59-69, Brier .2636; final Brier .2580 and log loss .7090 | 4-8, -4.360u | Projection-edge challenger to forward shadow | Market evidence insufficient; actionability rebuild required |
| WNBA spread | 62-66, Brier .2570; final 9-11 | 18-26, -9.856u; away side 13-23, -11.369u overall | Rebuild required | Market evidence insufficient; actionability rebuild required |

### MLB moneyline

The model still has full-history ranking value, but the final period shows
material overconfidence, concentrated on away selections: away went 24-33 with
a 57.3% mean forecast and lost 15.083 units. A recalibrated incumbent improved
the incumbent's final Brier/log-loss pair to .2523/.6977, but the paired market
was still better at .2481/.6890. It therefore is not a champion.

The best opposite-side slice was positive in validation (4-5, +1.575u) and
final (4-7, +0.680u), which makes it a useful anti-signal to retain in shadow.
It had only 9 and 11 bets, failed the ten-date minimum, had bootstrap
probabilities of only 73.8% and 68.0%, and became negative when its best date
was removed. It is not a validated flip.

### MLB total

The important split is not simply Over versus Under prediction accuracy. Over
actions were approximately flat over the full history (100-91, +0.455u), while
Under actions were 72-83 and -18.044u. The candidate model/market stack slightly
improved the incumbent's final proper scores but remained worse than the paired
market and failed the complete champion gate.

The apparent opposite-side validation result was one bet. The identical rule
then went 0-5 in the final partition. That flip is rejected.

### MLB first inning (NRFI/YRFI)

This is the healthiest probability head. NRFI/Under was 212-155 and +23.782u
overall and 44-32, +2.494u in the final partition. YRFI/Over was 126-97 but
-0.921u overall and 18-16, -2.390u in the final partition. The incumbent beats
50/50 on both final proper scores, while the tested model/market stack was
worse. Retain the probability head; rebuild the action selector. No opposite
side met positive-EV qualification, so there is no FI flip candidate.

### WNBA moneyline

The probability head is genuinely informative; the betting conversion is not.
The full board was 88-40 but still lost 4.211 units, demonstrating why accuracy
cannot substitute for price. The current actionable cohort lost 4.383 units.
The side split is material: away actions were -34.8% ROI while home actions
were +6.7% ROI. That is a falsifiable side interaction for forward modeling,
not authority to ban away teams from the board.

### WNBA total

The incumbent is overconfident: 46.1% outcomes against a 58.3% mean forecast.
The projection-edge challenger reduced final Brier/log loss from .2580/.7090
to .2441/.6813 and improved both in two of four rolling folds, meeting the
predeclared shadow gate. The final sample is only 20 games across seven dates
and was not discovery-blind, so it remains shadow-only.

### WNBA spread

The incumbent failed the full-history 50/50 proper-score baseline, and the
projection-edge challenger was worse in the final partition and improved only
one of four rolling folds. Away-side performance was especially poor; however,
the evidence does not contain a balanced, validated replacement pool. Rebuild
rather than blanket-demote or flip.

## What the market signals say

MLB retains enough point-in-time evidence for a real diagnosis audit: 803 of
871 moneylines and 785 of 854 totals have frozen movement, while 572 and 563
respectively have complete selected-side source-aware splits. A joint
movement/splits probability model was worse than a simpler model-plus-market
baseline in the final partition for both markets and improved both proper
scores in only one of four rolling folds. Market evidence is valuable, but the
current evidence does not support one universal adjustment.

The untuned descriptive states reveal candidates worth forward testing:

- MLB moneyline model-led contrarian cases were 7-12 and -24.0% ROI in the
  final period; current actionables in that state were 3-7 and -36.2% overall.
  This supports a stand-down hypothesis, not an automatic opposite bet.
- MLB moneyline public-minority/fade candidates were 6-3 across seven dates and
  +21.6% ROI, but had no rows in the final partition. This is discovery-only.
- MLB total market-resistance actionables were 5-8 and -21.1% ROI, while the
  final eligible state was 9-9. This is a stand-down shadow candidate, not a
  production rule.
- MLB total public-fade candidates were 21-27 and -20.1% ROI overall, then 1-5
  and -70.6% in the final period. “Fade the public” is explicitly rejected as a
  generic totals rule.
- Simple model/market confirmation was not automatically profitable: -2.9%
  overall ROI for MLB moneyline and -3.3% for MLB totals. Confirmation is
  evidence, not actionability.

First-inning and historical WNBA records do not have the complete movement,
splits, and paired-price path needed to assign those diagnoses honestly. They
remain `stale_or_incomplete_evidence`, not neutral market reads.

## Implemented evidence fix

The WNBA authoritative prediction-record writer now records, for moneyline,
total, and spread:

- selected and opposite side;
- selected line and correctly signed opposite spread line;
- the selected record price and best current opposite American price at the
  exact paired line;
- selected-side no-vig market probability computed only from same-sportsbook,
  exact-line pairs, plus the contributing book count;
- an immutable paired-market snapshot contract version.

This adds no provider call, writer, timer, database write path, or reader rule.
It remains inside the existing WNBA `prediction_pipeline` lease. The paired
evidence never borrows the live writer's nearest-line or historical fallback.
Missing opposite prices stay null and cannot trigger a flip. The previous
prediction-record v2 contract is the rollback identifier.

## Production status and next proof

There are zero authorized live model or actionability changes in this commit.
That is not a claim that the current actionable layer is healthy; it means none
of the tested replacements met the standard required to change user bets
without either overfitting or silently flattening the board.

The next untouched WNBA cohort can now answer confirm/fade/resistance/flip
questions with real paired prices. For MLB, the promising moneyline stand-down
and fade states and the totals resistance state must be frozen before the next
outcomes and evaluated as balanced promotion/demotion candidates. Promotion is
allowed only after positive validation and untouched-forward results, at least
95% date-bootstrap probability of positive units, positive units without the
best date, and explicit board-count impact.

## Reproduction

```bash
npm run audit:market-specific-rebuild
SPORT=mlb STATES=1 npm run audit:market-specific-rebuild
SPORT=wnba STATES=1 npm run audit:market-specific-rebuild
FLIP_COHORTS=1 npm run audit:market-specific-rebuild
npm run test:wnba-paired-market-snapshot
npm run verify:model-change
```
