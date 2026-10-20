# NBA continuous market-residual reader predeclaration

Date: 2026-10-20

Status: predeclared research audit; no production authority

## Question

Can a smooth, market-evidence-conditioned correction improve the NBA final
score without the current two-point Spread and five-point Total cliffs and
without averaging the independent forecast with the market forecast?

## Frozen chronology

- 2024-25 is the only fitting and recipe-selection season.
- The first 60% of 2024-25 fits each candidate and the final 40% selects it.
- After selection, the chosen recipe is refit on all of 2024-25.
- 2025-26 is opened once for confirmation and cannot select or tune anything.
- The independent score release remains the frozen 75-feature
  ratings/schedule ridge used by production.

## Candidate contract

The candidate does not ingest the market-implied score and does not compute a
model/market weighted average. It fits two zero-at-zero residual corrections:

```text
final margin = independent margin + spread-evidence correction
final total  = independent total  + total-evidence correction
```

When every movement/price evidence feature is zero, the correction is exactly
zero. Evidence uses continuous opening-to-closing movement, price-probability
movement, book count, model/evidence disagreement interactions, and continuous
piecewise-linear spline terms. There is no movement threshold. A smooth tanh
saturation prevents an isolated proxy observation from creating an unbounded
score change.

Candidate ridge penalties are 1, 3, 10, 30, 100, 300, and 1,000. Smooth
saturation scales are 2, 4, 6, 8, and 12 points. Margin and Total heads select
their recipes independently on the held-out portion of 2024-25.

The incumbent comparator is the existing historical proxy behavior:

- Spread residual reorientation after a two-point move.
- Total residual reorientation after an opposing five-point move and a
  five-point independent edge.

## Selection gates

The margin head must improve margin MAE, not reduce winner accuracy by more
than 0.20 percentage points, not worsen winner Brier by more than 0.001, and
not reduce closing-spread direction accuracy. The Total head must improve Total
MAE and not reduce closing-Total direction accuracy. If no recipe clears its
head gates, that head is rejected and remains independent.

## Confirmation gates

Against both the independent score and the hard-gate incumbent, the combined
candidate must:

1. improve team-score MAE;
2. improve margin MAE;
3. improve Total MAE;
4. not reduce winner accuracy;
5. not worsen winner Brier;
6. not reduce main Spread direction accuracy;
7. not reduce Total direction accuracy; and
8. preserve a finite coherent score for every eligible game.

Failure rejects the candidate. Passing this public consensus proxy still does
not authorize production because it cannot reproduce source-specific same-book
trails, splits, target-book exclusion, or the actual decision-time cutoff.

