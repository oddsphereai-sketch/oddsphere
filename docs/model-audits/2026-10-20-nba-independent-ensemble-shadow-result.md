# NBA independent ensemble shadow result

Date: 2026-10-20

Decision: no production forecast change. The frozen challenger proceeds only as
a prospective shadow alongside the r9/r6 production model-reader family.

## Chronological selection

The finite 30% adjusted-rating margin / 20% adjusted-rating Total recipe ranked
first across rolling 2022, 2023, and 2024 origins. Its mean three-score relative
error was 0.99741 and its worst-season relative error was 0.99823, where lower
than 1.0 is better than the incumbent. Mean margin MAE improved by 0.0289 points,
winner direction improved by 0.027 percentage points, and winner Brier improved
by 0.000437.

## 2025 confirmation

| Metric | Incumbent | Challenger | Delta |
|---|---:|---:|---:|
| Team-score MAE | 9.5620 | 9.5364 | -0.0256 |
| Margin MAE | 11.3705 | 11.3168 | -0.0537 |
| Total MAE | 15.2235 | 15.2117 | -0.0119 |
| Winner accuracy | 68.13% | 68.21% | +0.08 pp |
| Winner Brier | 0.20508 | 0.20372 | -0.00136 |
| Predicted-margin SD | 6.879 | 7.224 | +0.345 |
| Margin calibration slope | 1.117 | 1.075 | closer to 1.0 |

The candidate-defined under-three-point cohort fell from 57.51% to 55.56%, so
the predeclared promotion gate failed. Because the challenger changes which
games occupy that cohort, a diagnostic compared identical games after the gate
was adjudicated. On the incumbent's fixed 386 close games, the challenger was
57.77% versus 57.51% on winner direction and reduced margin MAE from 11.8505 to
11.7767. This is explanatory evidence only and does not reverse the failed
gate.

Opening-line diagnostics are not a replacement for the live reader. The
challenger reached 49.53% against the available 2025 opening Spreads, while the
released categorical final-product proxy remains the stronger historical
Spread result at 52.94%. Authentic same-book decision-time chronology and
source-specific split history do not exist for that historical cohort.

## Current-board impact before reader application

The frozen challenger changes the October 20 independent scores as follows:

| Matchup | Incumbent margin | Shadow margin | Margin change | Total change |
|---|---:|---:|---:|---:|
| BOS at DET | BOS 0.48 | DET 0.10 | 0.57 toward DET | -0.34 |
| PHI at NY | NY 2.97 | NY 4.43 | 1.46 toward NY | -0.32 |
| OKC at SA | SA 0.34 | SA 1.06 | 0.71 toward SA | +0.40 |

These are modest matchup-specific changes rather than a blanket widening rule.
They do not justify changing the opening-night board. The prospective shadow
therefore sends its own score through the same r6 reader with independently
resolved execution-book exclusions, but stores the result with zero production
authority.

## Verification

- New shadow unit and override-isolation test: passed.
- NBA professional candidate, reader, runtime-artifact, and locked-snapshot
  suites: passed.
- TypeScript: passed.
- `npm run verify:model-change`: passed.

The generated research reports remain `/private/tmp/nba-independent-ensemble-shadow-r1.json`
and `/private/tmp/nba-independent-ensemble-shadow-r1-diagnostic.json`; they are
not runtime inputs.
