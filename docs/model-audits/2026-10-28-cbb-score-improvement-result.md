# Private CBB score accuracy — r2 result

The owner requested Total MAE below 10 and margin MAE below 6 if possible. R2 improves both
score errors and winner accuracy, but does **not** achieve either requested error target.
Everything remains on the unmerged prelaunch branch; no live grades, projections or site change.

Release: `cbb_candidate_2026_10_28_r2_score_precision`. R1 code and artifacts remain frozen.
The r2 private runtime is `lib/cbb/candidateR2Runtime.ts`, with its single frozen artifact
`lib/cbb/artifacts/candidate-r2.json`. There is no additional provider call or production writer.

## What changed and why

R1 excessively compressed both tempo and team strength. On the opened diagnostic cohort,
predicted pace had SD 1.38 possessions against actual pace SD 5.13. Its predicted margin SD
was 6.68 points against actual 15.05; these variances include unpredictable game noise, so
matching actual variance by inflating predictions would not be justified. Postgame actual-pace
substitution reduced Total MAE only to 12.08: a diagnostic oracle, never an eligible feature.

R2 gives tempo its own statistical precision, rather than applying the same penalty to an
observation equation with half-size team coefficients. A 2024-selected lower offense/defense
penalty also preserves more genuine team separation. A residual head trained on 2023 and
selected on 2024 adds learned matchup information: Four Factors interactions, pace, rest,
recent opponent-adjusted margin form, recent scoring/pace form and neutral venue. Features use
only eligible earlier games; every forecast still rebuilds a single pair of scores and all
Moneyline/Spread/Total probabilities from those scores. No arbitrary team or injury bump.

Eighteen regularization configurations times three heads (none, affine, matchup) were tested.
The 2024 criterion required both MAEs improve, winner accuracy decline no more than 0.5 pp,
Brier not worsen, then minimized normalized margin/Total error. The selected configuration is
offense/defense ridge 1, tempo ridge 0.25, prior carry 0.8, 90-day recency with the matchup head.
Two predeclared shallow absolute-error boosted-tree alternatives were also tested on 2024;
neither beat the selected matchup head. All 56 comparisons are retained, including rejections.
The final correction is refit on 2023–24; 2025 never supplies training labels or hyperparameters.

## Same-cohort result

| Metric | R1 | R2 |
| --- | ---: | ---: |
| Games | 5,721 | 5,721 |
| Winner record | 4,012–1,709 | 4,112–1,609 |
| Winner accuracy | 70.13% | 71.88% |
| Mean absolute margin error | 9.8388 | 9.2789 |
| Mean absolute Total error | 14.2817 | 13.6378 |
| Mean absolute team-score error | 8.7273 | 8.2995 |
| Brier | 0.190974 | 0.180016 |
| Log loss | 0.560683 | 0.530108 |
| Ten-bin calibration gap | 2.7904 pp | 1.3725 pp |

Winner changes: 420 corrected losses, 320 harmful changes, net +100 correct winners. This is
an independent-model comparison; those changes are not market-reader flips. Margin MAE falls
5.69% and Total MAE 4.51%. Same games and denominators are used; no removal of difficult games.

A fixed-seed 2,000-resample calendar-date block bootstrap over 148 dates gives candidate-minus-
baseline 95% intervals: margin MAE [-0.7522, -0.4065] points; Total MAE [-0.7725, -0.5113];
winner accuracy [+0.6797, +2.8026] percentage points. These quantify variability within the
opened retrospective sample; they do not account for model-selection bias, future seasons or
all persistent team dependence. This is not a guarantee or proof of a future 71.88% hit rate.

2025 was already opened during r1. The r2 result is an opened retrospective diagnostic
confirmation, not a new untouched holdout. Primary selection remains 2024. Additional tuning
on the 2025 misses must not be relabeled independent confirmation.

## Stability and costs

| Month | Games | Margin MAE change | Total MAE change | Net correct winners |
| --- | ---: | ---: | ---: | ---: |
| November | 1,236 | -1.2459 | -0.9618 | +34 |
| December | 955 | -1.1639 | -0.7797 | +41 |
| January | 1,518 | -0.1243 | -0.4263 | +21 |
| February | 1,366 | -0.0896 | -0.4254 | +5 |
| March | 633 | -0.3635 | -0.8432 | 0 |
| April | 13 | -0.8141 | +0.9144 | -1 |

April is a small explicit exception, not hidden in the full-season result. Overtime remains
especially difficult: Total MAE worsens 21.52→23.09 on 324 overtime games, while regulation-only
Total MAE improves 13.85→13.07. Actual future overtime cannot be used as a feature. A future
overtime-aware distribution must be trained using pregame close-game likelihood and evaluated
without assuming we knew which games would need overtime. Neutral-site margin MAE improves
9.59→9.19 and verified home-venue margin MAE 9.85→9.28.

## Market reading and the requested targets

No r2 improvement is attributed to market reading: no historical market inputs enter this
comparison. The existing prelaunch evidence adapters, exact named-team quotes and source
chronology remain available. A CBB reader must qualify its own adjustments and harmful flips
against the shared market-reader contract; NFL qualification cannot transfer automatically.
Current roster/availability impact, exact-price grades and the publication lifecycle remain
unfinished as documented in the r1 handoff. No cap, automatic injury deduction, price-based
forecast-side substitution or missing-data copy was introduced.

Sub-6 margin and sub-10 Total are ambitions rather than demonstrated feasibility. Research
context includes a different-cohort UNC schedule/context study reporting 9.42 margin MAE:
https://supermariogiacomazzo.github.io/sports-analytics-intelligence-laboratory/projects/Yunus_Poster_2026.pdf
That is neither a direct benchmark nor a lower bound. Meeting an error target by removing hard
games, tuning on confirmation, or relabeling error metrics is not a valid improvement.

## Reproduction and review

```bash
npx tsx scripts/operator/diagnose-cbb-score-errors.ts
npx tsx scripts/operator/improve-cbb-score-model.ts
npx tsx scripts/operator/improve-cbb-score-trees.ts
npx tsx scripts/operator/compare-cbb-score-candidates.ts
npx tsx scripts/test-cbb-score-research.ts
npx tsx scripts/test-cbb-prelaunch.ts
npx tsx scripts/operator/preview-cbb-prelaunch.ts --candidate=r2
```

Full local data and per-game errors remain under `/private/tmp/oddsphere-cbb-data/`; portable
selected artifacts, all candidate summaries and the paired report are in `lib/cbb/artifacts/`.
The existing local preview URL is updated to r2 only. Its scores, probability and readiness
payload stamp the r2 release. The production site still has no active CBB champion.
