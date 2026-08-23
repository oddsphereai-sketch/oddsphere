# NFL discrete drive joint r9 audit

Date: 2026-08-23

Status: rejected as a complete member release. Preserve as reproducible evidence.

## Frozen protocol

r9 used the predeclared shortest contiguous integer 80% intervals, fixed the
r8-selected scoring-event concentration at `1.00`, and fixed shared-environment
sigma at `0.00`. The representative-score weight was selected on 2023 only
from `0.00, 0.05, 0.10, 0.20, 0.40`. The selected weight was `0.05` by lowest
2023 combined team-score MAE, then exact-score hit rate, then lower weight.
The representative score was required to have positive PMF support, agree with
the PMF moneyline winner, be non-tied, and remain inside both central 80%
margin and total intervals.

## Confirmation

All frozen historical distribution gates passed.

- 2024 (272 games): joint negative log score `7.00801`, moneyline Brier
  `0.21118`, log loss `0.61192`, ECE10 `0.07889`, margin 80% coverage
  `84.56%`, total 80% coverage `87.87%`.
- 2025 (272 games): joint negative log score `6.98788`, moneyline Brier
  `0.21878`, log loss `0.62611`, ECE10 `0.04814`, margin 80% coverage
  `86.03%`, total 80% coverage `84.56%`.
- Representative-score winner fidelity and support were `100%` in selection
  and both confirmation seasons, with zero tie contradictions.

## Current Week 1 result

The representative scores had healthy structural dispersion: team-score SD
`3.13`, margin SD `4.38`, total SD `4.12`, team scores `17..27`, margins
`-4..10`, totals `37..51`, and six Over versus ten Under directions. Winner
fidelity was `100%` with zero tie contradictions.

The release nevertheless failed its product gate because eight of sixteen
games reused an already-present away/home score pair; the frozen maximum was
six. The PMF and historical interval correction passed, but the selected
point-functional remained too concentrated for the member display.

## Decision

No production model, probability, score, grade, stake, writer, tracking row,
or reader changed. Promotions and demotions are both zero. r9 is not a
production target. The next candidate must select a more center-faithful,
week-differentiated representative-score functional on 2023 without changing
the passing PMF marginals or using 2024/2025 outcomes for selection.
