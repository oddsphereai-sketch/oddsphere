# NFL Spread/Total High-Conviction Provisional Lane — Predeclaration

## Scope and chronology

This materially different candidate treats the qualified r10 discrete joint PMF as the
forecast and asks whether its strongest exact-line disagreements can support a small,
explicitly provisional early-week lane. It does not replace r10, copy the target book,
or select a quota of plays.

- 2022 remains model-development evidence only.
- 2023 selects one fixed rule independently for Spread and Total.
- 2024 and 2025 are opened once for chronological confirmation.
- Current Week 1 rows are excluded from rule selection.

## Frozen policy family

Each offer must have a timestamp before kickoff, at least two target-excluded comparison
books, a bounded price from -200 through +200, r10 direction agreement, and a coherent
same-line market. The best eligible exact quote per game and market is retained.

The grid is:

- conditional r10 probability: 55%, 57.5%, 60%, 62.5%, 65%, 67.5%, or 70%;
- exact-price EV: 0%, 1%, 2%, or 3%;
- r10 edge over leave-one-book-out fair probability: 0, 1, 2, or 3 percentage points;
- expected scoring cushion beyond the line: 0, 0.5, 1, 1.5, or 2 points, with the
  existing extra half-point penalty at key spreads and extreme total zones.

Selection requires at least 10 bets across at least six weeks, positive units, no worse
than -1 unit after removing the largest win, no worse than 15 percentage points of
aggregate calibration error, and at least two books. Mean CLV and positive-CLV frequency
are reported but are not absolute gates because this is a forecast-conviction lane, not
a closing-line replication policy.

## Confirmation contract

A provisional Lean lane is authorized only when all are true:

- at least 20 pooled confirmation bets and at least seven in each season;
- positive pooled units and positive pooled units after removing the largest win;
- neither season is below -10% ROI and at least one season is positive;
- pooled calibration error is at most 12 percentage points and neither season exceeds
  18 percentage points;
- weekly-cluster bootstrap probability of positive units is at least 60%;
- at least two evaluated sportsbooks contribute.

The bootstrap confidence interval may cross zero. This release, if qualified, is labeled
provisional and cannot increase stakes. Best Angle requires positive units in each season,
positive largest-win-independent units in each season, pooled ROI at least 4%, bootstrap
positive probability at least 75%, and tighter 12-point per-season calibration.

Watchlist is non-actionable: the same health/direction/price bounds, probability at the
selected Lean floor, and either EV within two points of the Lean boundary or a model edge
within two percentage points of the boundary. No Play is the coherent evaluated fallback;
Held is reserved for identity, quote, health, or availability failure.
