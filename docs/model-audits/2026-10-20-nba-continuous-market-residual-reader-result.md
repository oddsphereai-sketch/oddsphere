# NBA continuous market-residual reader result

Date: 2026-10-20

Status: rejected proxy; no production change

## Outcome

The predeclared continuous reader removed the two-point Spread and five-point
Total activation cliffs. It fitted smooth zero-at-zero residual corrections
from 2024-25 consensus movement evidence and opened 2025-26 once after recipe
selection. It did not average the independent score with a market score.

Selection chose:

- margin ridge alpha 100 with 12-point smooth saturation;
- Total ridge alpha 30 with 8-point smooth saturation.

## Untouched 2025-26 confirmation

| Metric | Independent | Hard-gate reader | Continuous candidate |
|---|---:|---:|---:|
| Team-score MAE | 9.5621 | 9.5109 | **9.3060** |
| Margin MAE | 11.3453 | 11.0537 | **10.9145** |
| Total MAE | 15.2367 | 15.1556 | **14.7983** |
| Winner accuracy | 68.14% | 69.28% | **69.53%** |
| Winner Brier | 0.20468 | 0.19874 | **0.19550** |
| Main Spread | 48.86% | **52.94%** | 51.63% |
| Spread +3 | 57.43% | **62.01%** | 61.03% |
| Spread +6 | 66.83% | **70.92%** | 70.42% |
| Total direction | 51.80% | **52.61%** | 51.47% |
| Selected-underdog accuracy | 49.56% | **52.92%** | 51.65% |

The continuous candidate materially improved every score-error and winner
metric. Its typical correction was also substantially less violent than the
hard rule: margin mean absolute correction was 1.73 points versus 2.19, margin
95th percentile was 6.28 versus 13.00, and the maximum was 11.97 versus 41.54.

It nevertheless failed the predeclared final-product gates because main Spread
accuracy declined 1.31 percentage points from the hard reader and Total
accuracy declined 1.14 points. Total accuracy was also below the untouched
independent model. The candidate is rejected and receives no live or shadow
authority.

## Interpretation and next design

The result demonstrates that the hard thresholds currently combine two jobs:

1. changing the expected score; and
2. classifying which side of a betting line is more likely.

A single conditional-mean correction can improve score MAE and Moneyline
accuracy while worsening the median/sign decision needed for Spread and Total.
The next candidate must therefore model a conditional distribution rather than
forcing one regression output to perform both jobs.

The next design should retain the improved continuous mean correction and fit
market-conditioned residual scale and side probability on the selection
season. The projected score remains the distribution mean. Spread and Total
probabilities come from that same fitted distribution, with market evidence
allowed to alter mean, uncertainty, and asymmetry continuously. A strong signal
can still flip a side; disagreement or buyback can widen uncertainty and lower
the grade without manufacturing a mean shift.

Historical public consensus remains only a proxy. Exact production authority
still requires source-specific same-book trails, splits, target-book exclusion,
decision-time evidence, and release-pure evaluation.

## Post-hoc side-loss diagnosis

This section was added only after the 2025-26 confirmation result was opened.
It is diagnostic evidence, not a second untouched confirmation and not
production authority.

The continuous candidate and hard-gate reader disagreed on 160 resolved Spread
decisions. The continuous candidate repaired 72 hard-reader losses but harmed
88 hard-reader wins, a net loss of 16 decisions. Eleven of those net losses
occurred when the consensus Spread moved between two and three points. In the
338 games where a move of at least two points opposed the independent side,
the independent model was 42.60%, the hard reader was 57.40%, and the
continuous candidate was 52.07%. The continuous correction generally moved in
the useful direction but often stopped short of the posted Spread.

The Total failure was different. The continuous candidate and hard reader
disagreed on 266 resolved decisions, with 126 repairs and 140 harms. Inside the
84-game incumbent Total gate, the independent model was 44.05%, the hard
reader was 55.95%, and the continuous candidate was 52.38%. Outside that gate,
the continuous correction sometimes crossed the posted Total without evidence
that had historically earned side-changing authority.

This identifies an objective mismatch rather than a failed continuous score
model:

- qualifying Spread evidence should retain authority to cross the exact line;
- unqualified Total evidence should not cross the exact line; and
- neither rule requires mirroring the entire independent residual, which is
  what caused the hard reader's unnecessarily large score changes.

### Minimum-coherent-crossing diagnostic

A fixed, untuned 0.25-point coherence rule was then applied post hoc:

1. begin with the continuous candidate's margin and Total;
2. retain the incumbent reader's already-qualified side decision; and
3. only when the continuous location contradicts that side, place the location
   0.25 points beyond the exact posted line instead of mirroring the full
   independent residual.

On the already-opened 2025-26 season, this diagnostic retained exactly the hard
reader's Spread, Total, underdog, +3, and +6 decisions while improving all
point-forecast and Moneyline metrics:

| Metric | Hard reader | Continuous | Minimum-coherent diagnostic |
|---|---:|---:|---:|
| Team-score MAE | 9.5109 | 9.3060 | **9.2869** |
| Margin MAE | 11.0537 | 10.9145 | **10.8908** |
| Total MAE | 15.1556 | 14.7983 | **14.7613** |
| Winner accuracy | 69.28% | 69.53% | **69.53%** |
| Winner Brier | 0.19874 | 0.19550 | **0.19525** |
| Main Spread | **52.94%** | 51.63% | **52.94%** |
| Total direction | **52.61%** | 51.47% | **52.61%** |
| Selected-underdog accuracy | **52.92%** | 51.65% | **52.92%** |
| Spread +3 | **62.01%** | 61.03% | **62.01%** |
| Spread +6 | **70.92%** | 70.42% | **70.92%** |

The same fixed rule was also checked on the chronological held-back 40% of the
2024-25 selection season. Against the hard reader it improved team-score MAE
from 9.1909 to 8.9110, margin MAE from 10.8850 to 10.5394, Total MAE from
14.4977 to 14.0581, winner accuracy from 70.82% to 71.63%, and Brier from
0.19664 to 0.19142 while preserving the hard reader's 49.49% Spread and 52.86%
Total directions. This supports the mechanism but does not erase the post-hoc
nature of the 2025-26 discovery.

The production follow-up must reproduce this concept with the exact live
reader qualification state. It must not import public-consensus coefficients
as though they were equivalent to source-specific same-book trails. A future
promotion requires a new release identifier, same-input board impact,
actionable promotion and demotion counts, locked-record precedence, and
release-pure forward evaluation.
