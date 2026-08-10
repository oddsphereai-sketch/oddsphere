# MLB + WNBA Deep Market Recalibration Audit — 2026-08-09

## Corrected conclusion

The first version of this audit was wrong to frame MLB evidence around the two settled dates of
decision release `r25`. That release is only the final decision/reader policy. It is not the MLB
projection model or any of the three market probability heads.

The correct evidence base is:

- MLB projection core: **388 settled games** from July 8 through August 8.
- MLB moneyline probability head: **343 settled picks** from July 11 through August 8.
- MLB total probability head: **343 settled picks** from July 11 through August 8.
- MLB first-inning probability head: **238 settled, priced picks** from July 11 through August 8.
- WNBA stable total formula: **101 settled picks** from June 27 through August 8.
- WNBA current zero-home-bias spread formula: **40 settled picks** from July 22 through August 8.
- WNBA current moneyline head: **21 settled picks** from August 2 through August 8.

Decision releases, probability heads, projection cores, calibration formulas, grade policies, and
rule bundles are evaluated separately below. Nothing in this audit changes production behavior.

## What was analyzed

- 2,716 locked MLB/WNBA records from June 7 through August 8.
- 2,452 settled rows after launch-day exclusion.
- MLB: moneyline, full-game total, NRFI/YRFI.
- WNBA: moneyline, full-game total, spread.
- Locked American price, flat one-unit ROI, hit rate, Brier score, log loss, calibration gap,
  projection MAE/RMSE/bias, grade ordering, side, price, probability, edge, movement, public-money
  split, and real-price counterfactual flips.
- Chronological partitions are by **date**, not by row: first 60% of dates train, next 20%
  validation, final 20% holdout.
- A flip ROI is reported only when the actual locked opposite-side price exists.
- Explicit `no_bet` or stand-down rows are never counted as promotion candidates.

Audit programs:

- `ops-local/cross-sport-market-recalibration-audit-2026-08-09.ts`
- `ops-local/deep-market-calibration-analysis-2026-08-09.mjs`

## Stable-head scoreboard

| Head | Dates | Settled / priced | Record | Units | ROI | Predicted | Actual | Gap | Brier |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| MLB moneyline | Jul 11–Aug 8 | 343 / 342 | 203-139 | +16.81 | +4.9% | 57.4% | 59.4% | -1.9 pp | 0.2415 |
| MLB total | Jul 11–Aug 8 | 343 / 340 | 179-157-4 | +4.23 | +1.2% | 55.1% | 53.3% | +1.8 pp | 0.2529 |
| MLB first inning | Jul 11–Aug 8 | 238 / 238 | 138-100 | +14.90 | +6.3% | 56.6% | 58.0% | -1.3 pp | 0.2433 |
| WNBA moneyline v3 | Aug 2–8 | 21 / 21 | 13-8 | -1.76 | -8.4% | 66.3% | 61.9% | +4.4 pp | 0.1997 |
| WNBA total anchor | Jun 27–Aug 8 | 101 / 101 | 50-51 | -5.36 | -5.3% | 58.5% | 49.5% | +9.0 pp | 0.2587 |
| WNBA spread zero-bias | Jul 22–Aug 8 | 40 / 40 | 26-14 | +9.30 | +23.3% | 52.5% | 65.0% | -12.5 pp | 0.2422 |

The settled history says the MLB projection/probability system is not a two-day model and is not
generally broken. MLB moneyline and first inning have been profitable across a meaningful month.
The largest defects are in **grade ordering and specific cohorts**, not the existence of the base
MLB model.

## MLB moneyline

### Time stability

| Partition | N | Record | ROI | Calibration gap |
|---|---:|---:|---:|---:|
| Train, Jul 11–28 | 194 | 116-77 | +7.6% | -3.1 pp |
| Validation, Jul 29–Aug 2 | 71 | 45-26 | +13.3% | -5.9 pp |
| Holdout, Aug 3–8 | 78 | 42-36 | -9.4% | +4.7 pp |

The head was strong through August 2 and then regressed sharply. The August 3–8 grade policy also
failed to rank the board correctly: Best Angles went 5-7 (-30.1%), Leans 4-3 (0.0%), Market
Aligned 15-11 (-0.7%), and ungraded rows 17-15 (-13.8%). This is a current-period warning, not a
reason to discard the profitable month.

### Price efficiency

- Below -200: 15-11, **-20.4% ROI**, predicted 68.7% versus 57.7% actual.
- Holdout below -200: 4-6, **-45.7% ROI**, +28.7 point overconfidence.
- -161 to -200: 37-20, +1.5% ROI.
- -121 to -160: 87-55, +5.7% ROI.
- -100 to -120: 39-33, +2.0% ROI.
- Plus money: 25-20, +26.1% overall, but negative validation and holdout.

The model should not automatically flip heavy favorites: keeping them was profitable in train,
while flipping only won in the later partitions. Their 95% bootstrap ROI interval is wide
(-35.7% to +12.9%). The correct action is a heavy-favorite calibration/price monitor, not a live
fade.

### Best grade candidate

An exploratory promotion cohort materially outperformed the current ladder:

> Market Aligned, probability 53%–59.9%, edge at least 5 points, real price, not explicit No Bet.

| Partition | Promoted | Record | ROI |
|---|---:|---:|---:|
| Train | 25 | 16-9 | +25.6% |
| Validation | 15 | 8-7 | +14.6% |
| Holdout | 10 | 6-4 | +18.4% |
| All | 50 | 30-20 | +20.9% |

Under the current August grade era alone it was 6-4, +18.4% (n=10). It would expand the historical
actionable board from 79 to 129, so it is not ready for production. It is the strongest MLB ML
forward-shadow promotion candidate. Its thresholds were found during this audit, so the existing
holdout is a pseudo-holdout for this rule; it needs untouched forward results.

## MLB totals

### The main side asymmetry

- Unders: 98-66-3, **+12.9% ROI**, predicted 55.0%, actual 59.8%.
- Overs: 81-91-1, **-10.0% ROI**, predicted 54.7%, actual 47.1%.

The over weakness is real across the full head, but a universal over-to-under flip is rejected:

| Partition | Keep overs | Flip to locked-price unders |
|---|---:|---:|
| Train | -9.7% | +1.6% |
| Validation | -24.8% | +19.8% |
| Holdout | **+4.0%** | **-11.6%** |

The sign reversed in the most recent six dates. An automatic total flip would be overfit.

### Grade inversion

The stable head's grade ordering is poor:

- Best Angle: 18-18, -5.1% ROI.
- Lean: 26-23-1, +3.4% ROI.
- Market Aligned: 75-71, -2.7% ROI.
- Ungraded: 57-43-3, +7.5% ROI.

The clearest paired shadow policy uses edge bands while preserving explicit stand-downs:

> Demote actionable 5.0–6.49 point edges; promote non-actionable, non-No-Bet 8.5+ point edges.

| Partition | Demotion cohort | ROI | Promotion cohort | ROI |
|---|---:|---:|---:|---:|
| Train | 14 | -5.9% | 22 | +20.6% |
| Validation | 4 | -5.1% | 5 | +11.5% |
| Holdout | 7 | -44.8% | 10 | +12.0% |
| All | 25 | -16.7% | 37 | +17.0% |

Board impact is **+12 plays**, from 86 to 98 (+14.0%). Under the current August grade era, the
same cohorts are 2-5 (-44.8%) to demote and 6-4 (+12.0%) to promote, for a net +3 plays.

A more board-neutral 5–8 / 8+ swap also separates in all three periods, but the promotion holdout
is only +1.8% and it reduces the board by nine. The 5–6.5 / 8.5+ version is the better research
candidate, but both are post-selection findings and remain shadow-only.

### Projection accuracy

For the stable projection core (388 settled games, Jul 8–Aug 8):

| Projection | MAE | RMSE | Bias |
|---|---:|---:|---:|
| Raw model total | 3.610 | 4.513 | +0.303 runs |
| Market-aware total | 3.595 | 4.402 | +0.516 runs |
| Locked market total | **3.512** | **4.368** | -0.048 runs |

The market-aware adjustment improves raw RMSE but increases positive bias, and the locked market
line remains the best point forecast. That supports continued market anchoring. It does not
support stronger movement/split overrides.

### Probability recalibration

A train-fitted, side-specific Platt transform beat the identity transform on both later periods:

- Validation log loss: 0.6650 versus identity 0.6727.
- Holdout log loss: 0.6935 versus identity 0.7021.
- Holdout Brier: 0.2502 versus identity 0.2545.

This is the best probability-calibration candidate in the audit. Because the side asymmetry was
discovered while examining this dataset, it requires a new shadow calibration identifier and an
untouched forward window before it can alter displayed probabilities or grades.

## MLB first inning

### Head quality

The FI v2 head is the most stable MLB head:

- Train: 73-52, +8.3% ROI.
- Validation: 32-25, +2.6% ROI.
- Holdout: 33-23, +5.4% ROI.
- Identity calibration beat every shrink/Platt alternative in validation and holdout.

NRFI was 95-68 (+7.4%) and YRFI 43-32 (+3.7%). There is no side-flip case.

### Price-band defect

The -100 to -120 band was 37-48, -17.2% across all FI picks. Among actionable picks it was:

- Train: 22-23, -7.1%.
- Validation: 4-13, -55.1%.
- Holdout: 10-12, -13.5%.
- All: 36-48, -18.5%.

This is the most persistent FI defect, although its 95% bootstrap ROI interval still reaches
+1.9%. Every apparent non-actionable promotion counterpart in the favorable price bands is an
explicit No Bet/stand-down row. Promoting those would violate the decision contract. A live FI
demotion therefore fails the required paired-board test and is not approved. Track it as a
predeclared price-band shadow.

The FI snapshots also lack movement, source-aware split, CLV, and usable opposite-price evidence,
so no FI market-read or real-price flip rule can be tested yet.

## MLB movement and betting splits

### Moneyline

- Movement neutral: 102-69, +5.0%.
- Movement toward: 93-60, +6.3%, but **-11.5% holdout**.
- Movement against: 8-10, -7.3%, only n=18.
- Money minus tickets by 10+ points: +0.3% overall and -30.0% holdout (n=3 holdout).
- Money above tickets by 10+ points: -20.1% overall and -35.0% holdout.

### Totals

- Neutral movement: +13.5% and positive in train, validation, and holdout.
- Movement toward: -3.6% overall, shifting from -13.0% train to +26.1% holdout.
- Movement against: -4.6% overall, shifting from +17.3% validation to -18.1% holdout.
- Split gaps of either sign underperformed, but samples are small and time behavior is unstable.

Movement-neutral is descriptive, not a tradable signal. A paired rule that demoted
movement-against and promoted neutral rows failed because both sides reversed across partitions.
No movement, ticket, money, or sharp/public flip rule is approved.

## WNBA moneyline

The current v3 sample is only 21:

- Train: 8-4, -11.5% ROI.
- Validation: 1-2, -42.9%.
- Holdout: 4-2, +15.1%.

The probability head has good Brier/log loss for such a small sample, but price efficiency is
poor. Ten 65%+ picks went 9-1 yet returned only +25.6%; lower probability/price cohorts lost. No
calibration family beat identity on validation, and the three-row validation slice makes model
selection meaningless. Keep the head unchanged and accumulate evidence.

## WNBA totals

This is the clearest cross-sport model defect:

- Stable formula: 50-51, -5.3% ROI, +9.0 point overconfidence.
- Train: -13.2% ROI, +14.8 point overconfidence.
- Validation: +22.1% ROI, -7.4 point underconfidence.
- Holdout/current WNBA version: -17.4% ROI, +13.1 point overconfidence.

Side split:

- Overs: 38-31, +5.5% overall, but -22.5% holdout.
- Unders: **12-20, -28.5%**, losing in train (-42.7%), validation (-31.4%), and holdout
  (-12.7%). A result-only under-to-over inversion would be 20-12.

The 25% market anchor slightly improves raw point accuracy but does not solve selection:

| Projection | MAE | RMSE | Bias |
|---|---:|---:|---:|
| Raw total | 15.891 | 20.237 | -1.434 points |
| 25% market anchor | 15.786 | 19.795 | -2.758 points |
| Market line | 15.787 | 19.754 | -3.203 points |

Because anchoring preserves the sign of the raw model's edge, it cannot repair a wrong under side.
The next shadow must target **side selection and side-conditioned probability calibration**, not
another small MAE adjustment.

A side-specific Platt candidate improved holdout log loss (0.6741 versus identity 0.6842), but it
lost validation (0.7101 versus 0.6644). It is rejected as a calibration replacement.

WNBA records do not retain opposite prices, movement, source-aware splits, or CLV. The under flip
therefore has a valid result record but no reproducible locked-price ROI and cannot be promoted.
Capturing both total prices at lock is the highest-priority WNBA evidence repair.

## WNBA spreads

The zero-home-bias formula is directionally promising:

- 26-14, +23.3% ROI overall.
- Train 16-7 (+32.7%), validation 3-5 (-28.7%), holdout 7-2 (+45.2%).
- Watchlist rows alone: 24-14, +19.9%.
- Raw margin MAE 6.492 versus calibrated margin MAE 6.813; the calibrated point margin is not the
  source of the betting gain.

Promoting every watchlist spread would expand the board from two to 40 plays and relies on a
38-row cohort whose 95% bootstrap ROI interval is -10.1% to +49.1%. The validation failure and
board explosion reject that rule. Continue shadow tracking and search for a narrower, prospectively
defined subset after opposite-side prices and market reads are captured.

## Grade-system diagnosis

The grade labels are not consistently monotonic with realized return:

- MLB ML Best Angle beat lower grades overall, but collapsed in the latest six dates.
- MLB totals ungraded rows beat Best Angles and Market Aligned rows.
- MLB FI No Bet outcomes beat Leans and Best Angles, but those rows cannot simply be promoted
  because the stored stand-down reasons matter.
- WNBA spread Watchlists were profitable, while WNBA total Watchlists lost.

This does not mean grades should be sorted directly by historical ROI. It means the current grade
rules mix different constraints—model edge, price, projection agreement, movement, data quality,
and safety holds—and need market-specific forward calibration. A grade audit must always exclude
explicit No Bet/Held rows from the promotion pool and report board count.

## Release/source coherence correction

The local working branch is behind production and contains older MLB/WNBA champion constants.
Read-only inspection of `origin/main` resolves the apparent mismatch:

- `origin/main` stamps MLB decision `r25`, rule bundle `v24`, and grade policy `v19`.
- `origin/main` expects WNBA `wnba_v1_1_team_identity` and moneyline head v3.

Therefore the stored August identifiers are coherent with the current main branch. The earlier
report's claim that those identifiers were absent from the source tree was a branch-context error.
No branch switch or merge was performed because the working tree contains unrelated user work.

## Recommended model evolution

### Start as new shadow releases

1. **MLB totals grade ladder:** predeclare the 5.0–6.49 demotion / 8.5+ promotion pair, preserve all
   existing No Bet, data-quality, price, and projection-conflict guards, and stamp a new shadow
   grade/rule identifier. Require at least 75 forward totals and 25 rows in each changed cohort.
2. **MLB totals probability:** shadow the side-specific Platt transform under a new calibration ID.
   Judge log loss, Brier, calibration by side, grade migration, and board impact on untouched rows.
3. **MLB ML promotion:** shadow Market Aligned 53%–59.9%, 5+ point edge, real-price rows. Do not
   promote all 50 historical rows live; measure the added-board ROI and closing-price quality.
4. **MLB FI price monitor:** predeclare actionable -100 to -120 as a risk cohort, but do not demote
   until a valid paired promotion exists and future evidence confirms the loss.
5. **WNBA total side model:** build a shadow under-side correction/inversion candidate. It must log
   original side, candidate side, both locked prices, and separate side-conditioned probability.
6. **WNBA spread:** retain the zero-home-bias head and collect a larger forward sample; do not
   promote the whole Watchlist tier.

### Evidence capture required

- MLB FI and all WNBA markets: both-side locked prices, opener, lock timestamp, closing price/CLV,
  line movement, and source-aware ticket/money splits.
- Preserve immutable original and candidate sides so a flip can be graded without overwriting the
  champion record.
- Keep one sport-scoped `prediction_pipeline` writer/lease and one authoritative version path.

## Production decision

No live probability, prediction, grade, flip, stake, or market-selection change is made by this
audit. The strongest findings are real enough to justify new shadow releases, but they were found
while exploring this evidence and their bootstrap uncertainty remains material. Shipping them now
would reuse the discovery sample as proof.

The production order should be:

1. shadow MLB totals grade pair;
2. shadow MLB totals side-specific calibration;
3. shadow selective MLB ML Market Aligned promotion;
4. repair WNBA/FI evidence contracts;
5. shadow WNBA total under-side correction;
6. re-evaluate after untouched forward windows.

## Verification

- Both audit programs pass ESLint with no warnings.
- `npm run verify:model-change`: 38 pipeline-safety checks passed, plus all version/ownership and
  dedicated batter-model checks.
- WNBA core calibration: 49 passed.
- MLB core calibration: 6 passed.
- MLB first-inning v2: 62 passed.
- Movement thresholds: 35 passed.
- No database write, production mutation, release bump, deployment, grade change, or stake change
  was performed.
