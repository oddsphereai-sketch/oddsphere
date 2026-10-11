# CFB 2026 accuracy incident — replacement model predeclaration

Date: 2026-10-11

Status: research-only until every gate below passes

## Incident

The October 10 locked slate exposed a material product failure rather than a
minor tuning issue. The release-pure 76-game result was 42-34 Moneyline,
36-40 Spread, and 34-42 Total. Independent-to-final market reconciliation
corrected two Moneylines with zero harms, three Spreads with one harm, and four
Totals with four harms. The final Total reader therefore added no net wins,
and the final margin was less accurate than the independent margin.

The failure is repeatable in the 2026 chronology. When the independent winner
opposed the available target-book-excluded market favorite, the market side
won about 70% of those disagreements overall and more than 70% in the incident
week. The existing reader also required movement, reversal, or split evidence
before the current consensus could move the score. That gate left a stable but
strong consensus without authority and allowed extreme false-upset forecasts
to retain implausibly high confidence.

## Frozen evidence boundary

- All existing official locked rows remain immutable and are read only for
  replay. No historical projection, probability, pick, grade, price, stake, or
  evidence field may be rewritten.
- 2021-2025 data may train or regularize an independent football model.
- 2026 is replayed chronologically. A prediction may use only evidence stored
  before its lock. The evaluated sportsbook family is excluded from every
  forecast-side market aggregate.
- October 10-11 is the final incident holdout for candidate reporting. It may
  reject a candidate but may not be used to hand-author game exceptions.
- Split provenance remains distinct: named sharp-adjacent, fallback sportsbook,
  and public. Missing splits are neutral. Split percentage alone is never
  relabeled as verified sharp money.

## Replacement architecture under test

This is not a threshold adjustment to the October 9 reader. The tournament
must test one coherent final distribution built from:

1. a newly evaluated independent football forecast;
2. a target-book-excluded current Spread consensus with calibrated authority
   over winner and margin, especially in large model-market disagreements;
3. chronological price, line, reversal, resistance, source-class, and split
   evidence that can add to or reduce that authority;
4. a separately trained Total decision because a consensus Total is a fair
   expectation anchor, not by itself evidence for Over or Under; and
5. probability and grade calibration that cannot present an extreme
   model-market disagreement as high confidence without historical support.

The projected score, Moneyline winner, Spread side, Total side, probabilities,
and grades must all come from the same final distribution. No evaluated-book
price may enter the forecast; it is used only after the forecast for exact
price and expected-value evaluation.

## Mandatory validation

Report every 2026 date and week, not only the pooled average. The product goal
is at least 60% Moneyline and at least 50% Spread and Total direction in each
week, but retrospective clearance is not represented as a guarantee of future
results. A production candidate must, at minimum:

- materially improve October 10-11 and the full chronological 2026 replay;
- improve net corrections, margin MAE, team-score MAE, Moneyline calibration,
  and exact-price/actionable results without hiding harms;
- show named, fallback, and public split corrections and harms separately,
  including whether line/price action confirmed, resisted, or reversed them;
- pair every actionable demotion with a tested promotion path and report Best
  Angle, Lean, Watchlist, and No Play counts by market;
- preserve useful board coverage rather than manufacturing accuracy by making
  the board flat;
- pass same-input score/pick/probability/grade coherence, target-exclusion,
  lock-immutability, sole-writer, and `prediction_pipeline:cfb` lease tests;
  and
- bump every affected release identifier and update the current release
  registry in the same commit.

If these gates do not pass, the candidate remains research-only. Publication
requires a clean latest-main worktree, focused tests, `npm run
verify:model-change`, integration-safety verification, a protected pull
request, merge, and post-deploy proof of the live release and behavior.
