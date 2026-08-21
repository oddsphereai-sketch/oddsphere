# MLB first-inning r61 health follow-up

Date: 2026-08-21
Mode: read-only locked-history audit
Production change from this audit: none

## Result

The NRFI-heavy current slate is not evidence that the model has lost its YRFI
lane. In a confidence-band reconstruction of 422 settled actions, NRFI was
171-122 (+13.421 units, +4.6% ROI) and YRFI was 77-52 (+7.242 units, +5.6%
ROI). The current-day market itself favored NRFI in 12 of 15 games, so much of
the visible direction concentration was real market shape rather than a forced
NRFI quota.

The audit did identify a real distinction inside NRFI:

| Selected NRFI probability | Actions | Record | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| 52%-54% | 117 | 63-54 | -0.060 | -0.1% |
| 54%-57% | 124 | 74-50 | +7.514 | +6.1% |
| 57%+ | 52 | 34-18 | +5.967 | +11.5% |

The marginal 52%-54% NRFI band weakened after the original replication slice:
train was 12-12, validation 6-13, and the latest diagnostic window 11-10. In
contrast, 54%+ NRFI remained positive in each of those three windows and went
58-30 for +12.601 units in aggregate.

## Why no immediate first-inning rule change

A blanket 54% NRFI floor would be a post-hoc demotion rule found after
inspecting these outcomes. It also has no independently validated paired
promotion rule, and would materially flatten the board. The tested YRFI bands
do not supply a stable substitute: for example, 52%-54% YRFI was positive
overall but 5-7 in the latest window. Market-only and official-base-rate
alternatives also failed the chronological stability gates.

Accordingly, r62 preserves the r61 first-inning head and grade policy exactly.
The evidence supports describing 52%-54% NRFI as the marginal/riskier lane and
54%+ NRFI as the stronger lane, but not silently turning that descriptive
finding into a live grade change. Any future threshold candidate must be
predeclared, tested on untouched forward locks, paired with a valid promotion
path, and released under a new identifier.

The canonical 908-row tournament and the confidence-band follow-up were both
read-only. The band reconstruction contains one more qualifying action than
the canonical release replay because of a minor reconstruction-boundary
difference; this does not affect the conclusion and is another reason not to
promote the exploratory threshold.
