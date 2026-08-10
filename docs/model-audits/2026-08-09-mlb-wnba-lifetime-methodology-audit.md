# MLB + WNBA lifetime methodology and market-read audit

**Audit date:** 2026-08-09
**Production evidence window:** 2026-06-06 through 2026-08-08
**Status:** read-only research; no live prediction, probability, grade, stake, or selection changed

> **Deep-reconstruction revision:** After the initial record-level report, the audit was extended beneath `prediction_records` into 153,507 matched `line_history` rows, 141,120 `sharp_signals_history` rows, 7,512 provider split observations, rolling logistic comparisons, projection-residual tests, and day-cluster bootstraps. The results of that deeper pass are incorporated below.

## Executive conclusion

The prior review was not the deepest defensible review. This one re-examines the immutable records, the projection and probability methods, grading behavior, market baselines, price economics, movement, splits, data-quality states, release eras, and the code that writes the records.

The evidence does **not** support saying every current output is already the best achievable prediction.

The strongest conclusions are:

1. **MLB moneyline is modestly profitable, but the lifetime probability head is almost indistinguishable from the market.** The current probability era is better. The public grade ladder does not rank lifetime performance monotonically, and a market-aligned promotion cohort deserves a forward shadow test.
2. **MLB totals are the clearest weak market.** The model probability is worse than the stored market probability, overs are persistently weak after the first era, actionable rows lose, and the hard-coded launch run correction is still present even though the raw projection's lifetime bias is close to zero.
3. **MLB first inning is the healthiest market.** It has positive ROI, positive probability lift over the market, and a statistically credible hit-rate interval. The recent provisional/short-price weakness is real enough to monitor but not stable enough to change live rules yet.
4. **WNBA v1.1 materially improves point projections**, especially total and margin MAE, but there are only 21 settled games in that release. Its intervals remain wide.
5. **WNBA record tracking contains a material probability-contract error.** The public ML decision and grade use the final market-blended probability, while `prediction_records.model_probability` stores the earlier independent probability. Ninety-four of 111 ML records differ by more than 0.5 percentage points; the average absolute mismatch is 3.2 points and the maximum is 22.6.
6. **WNBA total and spread grades are price-blind.** They use point edge, book count, dispersion, and sharp agreement, but do not require positive expected value at the actual offered odds. This is a direct methodological weakness, especially because actionable WNBA totals and ML have lost.
7. **Exact historical flip ROI cannot be reconstructed honestly** for most markets because the opposite side's locked price is not persisted in the record. Outcome inversion is not the same as a bettable flip.
8. **Market movement rules are not ready for live use; signed MLB ML splits are useful but remain shadow-only.** Reconstructed history shows persistent failure when picked-side money trails tickets by at least ten points and a strong non-actionable promotion cohort when money leads tickets. The promotion weakens in August and does not improve later probability calibration, so it should rank a shadow board rather than alter confidence immediately. FI and WNBA still lack adequate historical movement/split state.

9. **The MLB grade engine has a deterministic market-read bug.** It loads one `sharp_signals` row per side but collapses them into a map keyed only by game and market. The last side encountered overwrites the other. The divergence classifier then takes the absolute ticket-money gap and assumes that surviving row is the sharp side. Signed opposing money can consequently be treated as aligned sharp evidence, and EV availability can depend on unspecified row order.
10. **The large historical table counts overstate longitudinal CLV coverage.** The matched line-history inventory is enormous, but settled-game reconstruction exists primarily from August 5 onward: only 56 MLB ML/total games, 40 FI games, and 13 WNBA games. The split-history table, by contrast, reconstructs 768 MLB ML and total records across the production window.
11. **A feature-heavy residual correction does not improve MLB total projections out of time.** Raw totals beat global bias correction, the existing market calibration, and a ridge residual model using team, line, weather, park, feed quality, and confirmation features. The total problem is chiefly probability/side/grade calibration, not an obvious missing linear point-projection adjustment.

## Deep reconstruction: what the additional data changes

### Data actually joined

| Historical source | Matched rows | What it can support |
|---|---:|---|
| `line_history` | 153,507 | Same-book price/line trails, but only recent settled-game coverage |
| `sharp_signals_history` | 141,120 | Repeated pre-lock MLB split observations |
| `public_splits_observations` | 7,512 | Provider observations; mostly current/upsert state rather than complete history |
| Settled game records | 2,483 including launch rows | Outcome and locked recommendation anchor |

The important lesson is that row count is not equivalent to independent sample size. Tens of thousands of line rows can be repeated books and refreshes for only a few slates.

### True open/lock/close reconstructability

The line-history join found usable opening/locking/closing states only for the final four audited days:

- MLB ML and total: 56 records, August 5-8;
- MLB first inning: 40 records, August 5-8;
- WNBA ML/spread: 13 records;
- WNBA total: 13 lock/close states but only five opening states.

A direct query for a June 16 MLB game returns zero `line_history` rows. Therefore lifetime CLV cannot be recovered merely by scanning the current table. The historical provider data would need to be re-fetched or restored from an external archive.

### MLB signed split divergence

Using the latest valid picked-side split observation at or before lock:

| Picked-side money minus tickets | n | Record | ROI |
|---|---:|---:|---:|
| At least +10 points | 217 | 130-87 | +12.2% |
| Within ±10 points | 337 | 202-135 | +2.7% |
| At most -10 points | 214 | 106-108 | -13.1% |

Chronological results for money at least ten points above tickets:

- train: +10.3%;
- validation: +14.2%;
- holdout from July 28: +11.0%;
- August alone: **-11.2%** on 20 plays.

For money at least ten points below tickets:

- June: -13.7%;
- July: -12.4%;
- August: -13.3%;
- train: -19.7%; validation: -3.1%; holdout: -5.2%.

The opposing-money cohort is more persistently bad than the supporting-money cohort is persistently good.

### Grade interaction

The signed split signal is strongest precisely where the current grade ladder is weak:

- non-actionable +10 money gap: 112 plays, +22.9% ROI;
- actionable +10 money gap: 105 plays, +0.9%;
- actionable -10 money gap: 64 plays, -17.1%;
- non-actionable -10 money gap: 150 plays, -11.4%.

A paired historical board that demotes actionable -10 gap rows and promotes non-actionable +10 gap rows changes the lifetime split-covered ML board from 282 plays at -1.5% to 330 plays at +9.5%. In the current probability head it changes 79 plays at +8.5% to 128 at +11.4%. In the holdout it changes 47 plays at +11.9% to 57 at +13.6%.

However, the unguarded August-only promotion cohort lost 13.0%. The implemented
candidate therefore adds a 54% model-probability guard; its reconstructed August
board improves from -3.3% to +1.0% without requiring a future waiting period.

### Cluster-bootstrap uncertainty

Resampling whole slates rather than pretending every pick is independent gives:

| Cohort | ROI | 95% day-cluster interval | Probability ROI > 0 |
|---|---:|---:|---:|
| MLB ML money gap ≥ +10 | +12.2% | -1.9% to +26.1% | 95.6% |
| MLB ML money gap ≤ -10 | -13.1% | **-24.7% to -0.9%** | 1.7% |
| Non-actionable money gap ≥ +10 | +22.9% | **+3.6% to +41.4%** | 98.9% |
| Actionable money gap ≤ -10 | -17.1% | -38.9% to +6.3% | 7.2% |
| Earlier market-aligned promotion rule, corrected edge units | +27.5% | -16.2% to +69.2% | 89.0% |
| MLB FI actionable | +7.5% | -3.5% to +19.5% | 90.8% |

This makes the non-actionable supporting-money cohort the strongest retrospective MLB promotion candidate, while persistent opposing money is the stronger demotion warning.

### Does split divergence add predictive probability information?

Rolling logistic models controlled for model probability, selected price, actionability, and projection conflict.

- Train through July 7 → validation: adding continuous split gap slightly improved Brier from .24253 to .24188 and log loss from .67782 to .67667.
- Train through July 27 → later holdout: it worsened Brier from .24287 to .24420 and log loss from .67909 to .68208.
- Train through July 31 → August: it worsened Brier from .24819 to .25002 and log loss from .68995 to .69403.

Therefore signed splits currently have stronger evidence as a **board-ranking/context signal** than as a probability recalibration input.

### MLB grade-engine root cause

`gradeDerivationService` reads every side from `sharp_signals`, then performs:

```text
Map key = game_id + market_type
```

instead of:

```text
Map key = game_id + market_type + side
```

Multiple side rows overwrite one another. `signalEvidenceClassifier` then:

1. computes `abs(public_money_pct - public_betting_pct)`;
2. labels alignment using the surviving row's side;
3. assumes that row represents the higher-money side.

The writer actually persists one row per side. The assumption is false. A picked-side row with 70% tickets and 50% money has a 20-point absolute divergence, but that is opposing money, not aligned sharp money.

This is not merely overfitting or sample noise. It is a source-selection and sign-semantics defect that can scramble grade evidence. It should be repaired under a new grade/release identifier and evaluated in shadow before altering public grades.

### Cross-market incremental probability tests

Latest chronological holdouts compared the raw published probability with the selected-price baseline:

| Market | Raw model Brier | Selected-price Brier | Better holdout input |
|---|---:|---:|---|
| MLB ML | **.24055** | .24435 | Model |
| MLB total | .24748 | **.24672** | Price |
| MLB FI | **.24182** | .24326 | Model |
| WNBA ML | **.18559** | .18655 | Model, narrowly |
| WNBA total | **.24345** | .24884 | Model |
| WNBA spread | .24282 | **.24082** | Price |

Combining model and price did not beat the best standalone input in these holdouts. Their information is highly overlapping, and an additional fitted blend can overfit the prior era.

Most notably, an FI calibration learned on older rows assigns negative slopes and performs far worse than the raw current probability in the holdout. This validates release separation: recalibrating current FI on blended historical eras would damage it.

### MLB total residual-model test

A ridge residual model was trained on June through July 7, tuned on July 8-27, refit, then evaluated from July 28 onward. It used raw total, market line, temperature, wind, park factor, proxy/missing/preferred counts, posterior movement, line agreement, lineup/starter confirmation, data quality, workload, and team indicators.

| Holdout projection | MAE | RMSE | Bias |
|---|---:|---:|---:|
| Raw total | **3.490** | **4.407** | **+0.388** |
| Global bias correction | 3.557 | 4.442 | +0.678 |
| Feature/team ridge residual | 3.645 | 4.533 | +0.670 |
| Existing market calibration | 3.573 | 4.409 | +0.677 |

The raw total is best. Adding historical team/weather/feed residual corrections makes it worse. This rejects a tempting but unsupported “correct all the team biases” change and focuses total work on distribution probabilities, side selection, and grades.

The right next step is a tracking-contract repair plus shadow releases—not silent live tuning.

## What history is actually valid

### Production records

| Sport / market | Settled records | Priced | Evidence start |
|---|---:|---:|---|
| MLB moneyline | 793 | 792 | 2026-06-06 |
| MLB total | 793 | 788 | 2026-06-06 |
| MLB first inning | 533 | 462 | 2026-06-06 |
| WNBA moneyline | 111 | 111 | 2026-06-24 |
| WNBA total | 111 | 111 | 2026-06-24 |
| WNBA spread | 111 | 111 | 2026-06-24 |

This is roughly 2,100 settled MLB market records and 333 settled WNBA market records after deduplicating by actual immutable record.

### Why the website can appear older than the production evidence

The database also contains 360 February-May MLB `game_predictions` rows labeled `daniels-v3.2` and 450 legacy `prediction_results`. Source inspection shows these are seeded from `lib/providers/mock/fixtures/historical_results.json` by `scripts/seed.ts` as a bootstrap “historical chain.” They are not suitable evidence for changing a live model and are excluded here.

This distinction is essential. Blending mock bootstrap outcomes with live locked predictions would create a larger sample but a false calibration claim.

## Overall market scorecard

| Market | Record | Units / ROI | Model probability vs actual | Model Brier | Market Brier | Model lift |
|---|---:|---:|---:|---:|---:|---:|
| MLB ML | 456-337 | +14.16 / +1.8% | 58.2% vs 57.5% | .2442 | .2445 | +.0003 |
| MLB total | 404-373-16 | -4.24 / -0.5% | 55.1% vs 52.0% | .2511 | .2485 | **-.0026** |
| MLB FI | 308-225 | +26.88 / +5.8% | 56.2% vs 57.8% | .2451 | .2486 | **+.0034** |
| WNBA ML | 74-37 | -5.96 / -5.4% | tracking mismatch | see below | see below | see below |
| WNBA total | 53-58 | -9.67 / -8.7% | 58.3% vs 47.7% | .2628 | unavailable | unavailable |
| WNBA spread | 55-56 | -6.45 / -5.8% | 55.9% vs 49.5% | .2576 | unavailable | unavailable |

For a secondary price baseline, the selected locked odds imply these Brier comparisons:

| Market | Model Brier | Selected-price Brier | Lift vs selected price |
|---|---:|---:|---:|
| MLB ML | .2441 | .2434 | -.0007 |
| MLB total | .2498 | .2494 | -.0004 |
| MLB FI | .2447 | .2468 | +.0022 |
| WNBA total | .2628 | .2520 | -.0109 |
| WNBA spread | .2576 | .2487 | -.0089 |

The selected-price baseline includes vig and is not a replacement for a two-sided no-vig market probability. It is still a useful check of whether published confidence beats the price members actually received.

## MLB projection methodology

### Point accuracy

| Projection | n | MAE | RMSE | Bias (prediction - actual) |
|---|---:|---:|---:|---:|
| Raw total | 791 | 3.615 | 4.659 | -0.125 |
| Market-calibrated total | 548 | 3.603 | 4.459 | +0.142 |
| Raw home margin | 791 | 3.561 | 4.712 | +0.057 |
| Market-calibrated margin | 548 | 3.620 | 4.802 | +0.099 |
| Home score | 791 | 2.497 | 3.308 | -0.034 |
| Away score | 791 | 2.554 | 3.317 | -0.091 |

The total anchor slightly improves RMSE but crosses from a small underprediction to a small overprediction. The calibrated margin is worse than the raw margin on both MAE and RMSE.

The current projection core improved margin MAE from 3.670 to 3.441, a meaningful positive result. Total MAE is almost unchanged by projection era: 3.588 before the core stamp versus 3.613 after it.

### Hard-coded correction concern

`lib/automodel/mlbCoreModelCalibration.ts` always starts the total correction at **+0.25 runs**, with the reason `launch_window_scoring_underprojection_plus_0.25`. That launch correction remains part of the general formula.

The lifetime raw total bias is now only -0.125 runs; in July it is +0.020 and in August +0.187. The calibrated total bias is +0.142. Therefore a permanent positive launch correction is no longer supported as a timeless constant.

This does not prove that +0.25 must be removed. It proves it should be re-estimated in a release-separated rolling shadow using current rows and interactions with starter/bullpen roles, rather than retained because it fixed an early launch window.

### Side coherence concern

For MLB totals:

- published pick direction hit 52.0%;
- raw projection direction hit 51.8%;
- calibrated-total direction hit 47.0%;
- the published side matched the raw projection side 83.9% of the time;
- the published side matched the calibrated total side only 64.3% of the time.

The product currently carries multiple notions of the “model total”: raw/posterior score, probability-selected side, and market-calibrated display total. Improving point RMSE is not sufficient if the calibrated total often points the other way from the published probability side.

## MLB moneyline

### What works

- Lifetime: +1.8% ROI with essentially neutral calibration gap.
- Current probability head: 343 records, +4.9% ROI and +.0033 Brier lift over the stored market probability.
- Stable projection era: +4.3% ROI and +.0035 Brier lift.
- Market-aligned rows: 196 records, +11.9% ROI.
- Plus-money picks: 122 records, +12.8% ROI.

### What does not work cleanly

- Actionable grades: 293 records, -0.6% ROI, with the model probability worse than market by .0024 Brier.
- Non-actionable rows: +5.6% ROI.
- Lifetime grade ordering is non-monotonic: Best Angle -2.3%, Lean +1.7%, Provisional +6.8%, Market Aligned +11.9%, ungraded -7.5%.
- Picks priced below -200: 49 records, -16.9% ROI, and model confidence exceeds realized outcomes by about 10 points.
- Probability 60-65%: -5.3% ROI; 65%+: -3.7% ROI.
- Model/score projection conflicts: 293 records, -3.2% ROI and Brier .007 worse than market. Aligned rows: +4.7% ROI and +.0045 Brier lift.

### Secondary retrospective promotion candidate

Post-hoc candidate:

> Non-actionable MLB ML, grade `market_aligned`, probability 53-60%, normalized
> locked probability edge at least 5 percentage points.

| Slice | n | Record | ROI |
|---|---:|---:|---:|
| Full production history | 41 | 25-16 | +27.5% |
| Early/train | 0 | — | — |
| Validation | 13 | 9-4 | +45.3% |
| Holdout | 28 | 16-12 | +19.3% |
| August | 17 | 7-10 | -13.3% |

This cohort has no true training-period observations and loses in August. It is
not used by the implemented grade policy. The older 70-row result was inflated
by an audit-unit bug that converted a 0.6 percentage-point edge into 60 points.

The corrected edge-unit result invalidates the older paired simulation that used
this cohort. The implemented paired board instead uses signed money/ticket gap
plus a 54% model-probability promotion guard; see the August 10 implementation
report for its full chronological board impact.

## MLB totals

### Core diagnosis

MLB total probabilities do not add value over the stored market baseline:

- Brier .2511 versus market .2485;
- log loss .6957 versus market .6903;
- average stated probability 55.1% versus 52.0% realized;
- actionable rows -3.8% ROI;
- stable-core rows -2.0% ROI and negative Brier lift;
- current probability head +1.2% ROI but still negative Brier lift.

The modest current profit is therefore more consistent with selection/price variance than with a demonstrably superior probability estimate.

### Over/under asymmetry

| Side | Lifetime behavior | Train | Validation | Holdout |
|---|---:|---:|---:|---:|
| Under | positive overall | -3.6% | +7.5% | +15.4% |
| Over | negative overall | -2.1% | -8.5% | -9.9% |

The post-train over weakness is one of the more persistent total signals. It should be investigated through residual calibration—park, temperature, wind, starter role, bullpen, line level, and price—not converted directly into “always bet under.”

### Feature degradation

Rows with exactly one missing captured feature lost about 21% ROI. The missing source was usually:

- bullpen: 88 rows, -22.0%;
- offense: 52 rows, -15.7%;
- lineup: 11 rows, -38.0%.

This is a genuine historical data-quality warning, but the cohort is dominated by June capture semantics. Only four such rows occur in August. It supports a current feed-health gate and monitoring alert, not a universal new betting rule.

### Candidate that fails the holdout

Promoting complete-input, non-actionable unders with at least 5 points of stored edge produced:

- train +19.3%;
- validation +16.8%;
- holdout **-9.5%**.

It is rejected as a live promotion rule.

### Recommended methodology work

1. Refit probability calibration separately for over and under using locked release IDs.
2. Shadow the current head against three baselines: price/no-vig market, raw distribution probability, and calibrated projection probability.
3. Re-estimate or remove the permanent launch correction only under a new release ID.
4. Treat missing bullpen/offense/lineup inputs as an explicit quality state and report board impact.
5. Require the side, displayed projection, and probability head to disclose when they disagree.

## MLB first inning

### Strongest production market

- 308-225, +26.88 units, +5.8% ROI.
- Model Brier .2451 versus market .2486.
- Model log loss .6834 versus market .6905.
- The 57.8% hit rate has a 95% Wilson interval of about 53.6%-61.9%.
- NRFI: +8.8% ROI; YRFI: +1.6%.
- Actionable rows: +7.5%; non-actionable: +4.1%.
- Current probability head: +6.3% overall and +5.4% actionable.

### FI-native audit findings

- Non-provisional current actionable rows: 145, +6.8%; early +5.7%, holdout +7.9%.
- Provisional current actionable rows: 53, +1.5%; early +25.9%, holdout -13.3%.
- Current “edge too thin; no bet” rows: 17, +31.2%; early +52.0%, holdout +7.9%.
- Current miscalibration-flag rows are positive overall but reverse to -20.7% in the five-row holdout.
- Posterior-capped rows do not underperform; they are +9.6% lifetime and +13.1% in the current head.

This contradicts a simple “large model-market disagreement is always bad” rule.

The recent provisional/short-price group is the concern: provisional prices from -100 through -120 went 8-17 and lost 39.6% overall, including 2-13 in the holdout. The earlier portion was positive, so it is a regime-warning candidate, not a stable retrospective law.

### Tracking limitation

FI has no usable locked movement or betting-split capture in these records. A first-inning market-read rule cannot be validated until FI-specific opening/lock/close prices and splits are stored.

## Market movement and betting splits

### Coverage

| Market | Movement coverage | Split coverage | Market-probability coverage |
|---|---:|---:|---:|
| MLB ML | 734/793 | 774/793 | 774/793 |
| MLB total | 711/793 | 774/793 | 768/793 |
| MLB FI | 0/533 | 0/533 | 461/533 |
| WNBA ML | 0/111 | 0/111 | 111/111 |
| WNBA total | 0/111 | 0/111 | 0/111 |
| WNBA spread | 0/111 | 0/111 | 0/111 |

### MLB movement

ML movement toward the pick is promising:

- 194 priced rows, +9.4%;
- train +15.7%; validation +12.2%; holdout +6.4%.

Movement against the pick is -13.1% overall, but the ten-row holdout is +30.1%. That reversal prevents a confident automatic demotion or flip.

Total movement is weak and unstable: toward +1.5%, against -1.5%, with direction changes across time slices.

### MLB splits

The first snapshot-level parser understated this relationship because it mixed snapshot sources. Reconstruction from the append-only signal history yields the corrected result: picked-side money at least ten points below tickets lost 13.1%, while money at least ten points above tickets gained 12.2%. The positive cohort weakened in August, but the negative cohort remained negative in June, July, and August.

### Conclusion on flips

No market-read **opposite-side flip** passes the standard for live use. Signed MLB ML split divergence does pass the bar for a forward shadow promotion/demotion test, but not for probability modification or an automatic opposite-side bet. A defensible flip test requires:

1. both locked side prices;
2. the actual opening and closing consensus;
3. source-stable split definitions;
4. a pre-registered rule;
5. chronological validation;
6. positive expected return after the opposite side's actual price, not merely an inverted hit result.

## WNBA projection methodology

### v1.1 improves the projections

| Metric | v1 | v1.1 |
|---|---:|---:|
| Total MAE | 17.489 | **13.133** |
| Total RMSE | 22.097 | **16.468** |
| Total bias | -1.943 | **-0.076** |
| Margin MAE | 9.497 | **7.381** |
| Margin RMSE | 12.739 | **9.414** |

This is the best evidence that the team-identity release is directionally better. It is based on 21 games, so it should not be treated as a settled long-run estimate.

Raw margin still beats the market-calibrated margin over the full production set: MAE 9.093 versus 9.266 and RMSE 12.175 versus 12.390. The original `homebias25` formula performed badly; the zero-home-bias formula is much better and preserves side coherence.

### Market enters the WNBA system multiple times

The current method can use the market as:

1. a cold-start Elo prior;
2. a dynamic ML probability blend;
3. a 30% nudge in the projected margin through the final ML probability;
4. a 25% spread-margin anchor;
5. a grade modifier through sharp agreement/public context.

Each individual use can be reasonable, but the combined model is not cleanly “independent model plus one calibration.” It risks double-counting correlated market information and makes attribution difficult. Each market contribution should be logged and ablated separately in shadow evaluation.

## WNBA moneyline

### Record-contract defect

The compute path grades and displays `finalPickedProbability`, but the record writer stores `model.home_win_prob`, not `model.final_home_win_prob`.

Observed impact:

- 94/111 ML records differ by more than 0.5 points;
- average absolute mismatch: 3.2 points;
- maximum mismatch: 22.6 points;
- v1.1: 17/21 mismatched, average 2.2 points, maximum 7.0.

Using the actual published confidence as the final picked probability:

| Release | Published Brier | Selected-price Brier | Lift | Calibration gap |
|---|---:|---:|---:|---:|
| All WNBA ML | .2086 | .2074 | -.0012 | +0.7 pp |
| v1 | .2093 | .2039 | -.0054 | approximately 0 pp |
| v1.1 | **.2056** | .2225 | **+.0169** | +3.9 pp |

This materially changes the interpretation. v1.1's published ML probability is better than the selected-price baseline in 21 games, even though the bets lost 8.4% ROI. The likely issue is price/selection economics and sample variance, not necessarily directional probability quality.

### Grade behavior

For v1.1 ML:

- all rows: 13-8, -8.4%;
- actionable: 6-5, -16.1%;
- non-actionable: 7-3, approximately break-even.

The 13-8 hit rate's 95% Wilson interval is approximately 40.9%-79.2%, far too wide for a strong release claim.

The current ML grade is appropriately value-aware in code, but the tracking mismatch must be repaired so the historical edge and grade can be audited against the same probability.

## WNBA totals

### Results

- Lifetime: 53-58, -8.7%, probability gap +10.6 points.
- v1.1: 9-12, -17.4%.
- v1.1 actionable: 0-3.
- v1.1 point projection is much better than v1, but betting selection has not yet followed.
- Lifetime unders: 13-24, -32.9%; overs: +3.4%.
- The under failure reverses recently, so “flip every under” is rejected.

### Methodology weakness

`gradeMarket` uses absolute point edge, number of books, line dispersion, and sharp agreement. It does not use the actual over/under price or a no-vig price probability.

Therefore a 3-point edge can receive a Lean even when the locked price makes the bet negative expected value under the model's own probability. The immutable record also stores no total market probability, so calibration versus a two-sided market cannot be audited.

The total-grade layer should be rebuilt around:

- picked probability;
- locked picked price and opposite price;
- no-vig market probability;
- expected value at the actual price;
- point edge as supporting context, not the entire value test.

## WNBA spreads

### Results and formula eras

- Lifetime: 55-56, -5.8%.
- v1: -8.9%.
- v1.1: 12-9, +7.4%.
- original home-bias formula: 25-33, -17.9%.
- zero-home-bias formula: 26-14, +23.3% over its mixed release window.
- v1.1 has no actionable spread plays; the positive result is entirely non-actionable/watchlist.

The v1.1 12-9 hit rate has a 95% Wilson interval of approximately 36.5%-75.5%. It is promising but very uncertain.

### Methodology weakness

Spread grading has the same price-blind structure as totals. It also derives the canonical margin from a market-blended ML probability and then applies a spread anchor. That may improve coherence while reducing independence. A shadow ablation should compare:

1. raw margin only;
2. ML-coherent margin only;
3. spread-anchor margin only;
4. the current combined canonical margin.

Evaluate both point error and ATS probability/EV. Do not choose a formula solely because it improves displayed score coherence.

## WNBA market-read and data-quality gaps

The WNBA prediction compute object contains `public_market_context`, but `buildWnbaPredictionRecords` does not copy it into `snapshot_json`. It also does not store opening/lock/close movement, source-aware splits, or total/spread no-vig probabilities.

Consequences:

- the effect of public split upgrades/downgrades cannot be reconstructed;
- a historical market-movement rule cannot be validated;
- exact total/spread model-versus-market calibration is unavailable;
- exact opposite-side flip ROI is unavailable;
- the simplified `data_quality_tier` does not preserve enough causal detail to attribute failures.

These are tracking problems, not reasons to infer that splits or movement have no value.

## Release fragmentation and overfitting risk

Across roughly two months, MLB records contain:

- two primary projection eras;
- numerous probability-head transition stamps;
- about 19 distinct grade-policy labels;
- about 13 decision-release labels.

Fast iteration is useful, but it creates small per-release samples and makes it easy to select a rule after observing the same outcomes multiple times. Lifetime grade performance blended across those policies is descriptive, not a current-policy estimate.

Future releases should be evaluated with:

1. an immutable release ID;
2. a locked timestamp;
3. a pre-registered rule and primary metric;
4. rolling-origin train/validation/holdout windows;
5. minimum sample and board-count requirements;
6. bootstrap uncertainty;
7. correction for the number of candidate rules searched;
8. an untouched forward confirmation window.

## Prioritized action plan

### P0 — repair MLB grade semantics and WNBA tracking

Under a new tracking/release contract:

1. Key MLB grade evidence by `(game, market, side)` and derive divergence from the **signed** picked-side money-minus-ticket gap. Never let row iteration order select the evidence side.
2. Store both WNBA independent and final published picked probabilities.
3. Make `model_probability` equal the probability used by the displayed confidence and grade.
4. Persist both locked side prices and a two-sided no-vig market probability for ML, total, and spread.
5. Persist opening, lock, and close line/price with provider timestamps, and define retention sufficient for a full season of CLV.
6. Persist `public_market_context`, raw split inputs, provider, and normalization version.
7. Persist all component projections and each market weight used in the canonical score.
8. Keep historical mismatched rows immutable; annotate the contract era instead of rewriting them.

### P1 — offline historical model releases

1. **MLB ML:** implement the guarded signed-split rule selected by chronological
   retrospective replay; keep the edge-based market-aligned cohort rejected.
2. **MLB totals:** run side-specific calibration retrospectively, with the launch
   +0.25 correction removed or re-estimated as separate candidates.
3. **MLB FI:** replay provisional short-price demotion and thin-edge promotion
   across the existing historical releases with paired board reporting.
4. **WNBA ML:** grade against the final probability and actual price; separately test favorite price bands and dog value.
5. **WNBA total/spread:** replace price-blind grade eligibility with probability-and-EV gates, retaining point edge and sharp agreement as secondary evidence.
6. **WNBA spread:** run the raw/coherent/anchored/combined ablation.

### P2 — evaluation standard for promotion

For each sport and market report:

- count, record, units, ROI;
- Brier score and log loss;
- calibration intercept/slope and reliability bins;
- comparison with no-vig market and selected-price baseline;
- projection MAE/RMSE/bias where applicable;
- chronological stability;
- feature/source coverage;
- opening-to-lock and lock-to-close CLV;
- actionable promotions and demotions;
- board-count change;
- confidence intervals and number of rules searched.

## Decision table

| Finding | Confidence | Live action now? | Next step |
|---|---|---|---|
| MLB ML current head improved | Medium | No rule change | Continue release-separated tracking |
| MLB ML market-aligned promotion cohort | Low-medium, post-hoc and August-negative | No | Rejected in favor of guarded signed splits |
| MLB total probability worse than market | High | No silent change | New side-specific calibration shadow |
| Permanent MLB +0.25 launch correction is stale-risk | High | No silent change | Re-estimate under new release |
| MLB total complete-input under promotion | Rejected | No | Failed holdout |
| MLB FI is strongest current market | Medium-high | Preserve | Monitor provisional/price cohorts |
| FI provisional short-price weakness | Low-medium | No | Forward shadow |
| MLB movement-toward rule | Medium | No | Source-stable forward test |
| MLB signed ML split ranking | Medium-high retrospectively; weaker August | Shadow only | Repair signed grade semantics and forward-test |
| WNBA v1.1 projection improvement | Medium | Preserve and monitor | Accumulate larger current-release sample |
| WNBA ML stored probability mismatch | High | Tracking repair required | New tracking contract; no history rewrite |
| WNBA total/spread price-blind grades | High | Methodology redesign in shadow | Add no-vig and EV gates |
| WNBA zero-home-bias spread improvement | Medium-low | Already directionally supported | Ablation + larger v1.1 sample |
| Any WNBA movement/split flip | Not testable | No | Capture missing inputs first |

## Final assessment

The model should not be “recalibrated across the board” with one global confidence haircut. The weaknesses are market-specific:

- MLB ML needs better selection ranking more than a wholesale probability rewrite.
- MLB totals need probability and projection-coherence work.
- MLB FI should be protected from over-tuning while its provisional/price ladder is monitored.
- WNBA projections are improving, but the tracking contract and price-aware grade logic must be corrected before aggressive optimization.

No live model change is authorized by this audit. All candidates remain shadow/audit-only until they satisfy the model-change safety protocol, including new release identifiers, focused tests, paired promotion/demotion analysis, board-count impact, clean deployment, and live coherence verification.
