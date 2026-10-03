# CFB spread-arbitration continuity result

Date: 2026-10-03

## Decision

Promote the narrow continuity repair. The five-point entry rule is unchanged. A previously
qualified favorite-side signal is retained only while the current observation still points to the
same side, for at most 24 hours, and only when the independent cover opinion is at least five
points from the current market line. A current opposite direction ends continuity immediately.

The writer also supplies its already-fetched verified named-book quote to the existing market-
outlook fallback. This repairs covered Spread/Total predictions that were absent despite a current
line. It adds zero provider requests and no member copy, labels, or layout.

## Release-pure replay

The select-only audit matched 230 settled games and 10,093 stored evidence rows. Weeks 1-2 were
selection; Week 3+ was confirmation.

| Block | Metric | Baseline | Candidate |
| --- | --- | ---: | ---: |
| Weeks 1-2 (96) | Moneyline | 82-14 (85.42%) | 84-12 (87.50%) |
| Weeks 1-2 (96) | Spread | 51-45 (53.13%) | 52-44 (54.17%) |
| Weeks 1-2 (96) | Margin MAE | 14.9350 | 14.5426 |
| Weeks 1-2 (96) | Team-score MAE | 9.9227 | 9.8821 |
| Week 3+ (134) | Moneyline | 109-25 (81.34%) | 109-25 (81.34%) |
| Week 3+ (134) | Spread | 68-66 (50.75%) | 68-66 (50.75%) |
| Week 3+ (134) | Margin MAE | 12.5654 | 12.5654 |
| Week 3+ (134) | Team-score MAE | 9.1772 | 9.1772 |
| All (230) | Moneyline | 191-39 (83.04%) | 193-37 (83.91%) |
| All (230) | Spread | 119-111 (51.74%) | 120-110 (52.17%) |
| All (230) | Margin MAE | 13.5545 | 13.3907 |
| All (230) | Team-score MAE | 9.4883 | 9.4714 |

Six signals were retained and three historical scores changed. Confirmation had two retained
signals but zero score changes, so its non-inferiority evidence is exact but limited. Broader
same-side and favorite-only variants were rejected after each lost one confirmation Spread and
worsened at least one error metric. The promoted rule is the narrower predeclared five-point
independent-disagreement variant.

## Board and safety impact

There is no grade-policy change: zero threshold promotions, zero threshold demotions, and zero
actionable-count change. Total direction is preserved by construction. Focused production tests
cover same-direction continuity, opposite-direction termination, 24-hour expiry, PMF identity,
cross-market coherence, T-60 tracking, one writer, and member publication.

The sole `prediction_pipeline:cfb` lease and append path remain authoritative. Existing correct
locks remain immutable. Any explicitly authorized emergency correction must use the existing
release-stamped recovery path and pre-kickoff evidence only.
