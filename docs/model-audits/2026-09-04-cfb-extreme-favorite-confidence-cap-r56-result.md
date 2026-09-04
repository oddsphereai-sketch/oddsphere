# CFB extreme-favorite confidence cap r56 — result

Date: 2026-09-04

Status: implementation candidate passed the identical-input board comparison and focused tests; protected publication and production verification remain required.

## Implemented behavior

The continuous model-plus-evidence score remains authoritative for the selected side and its uncapped confidence grade. Only selected CFB moneyline favorites receive a post-score display-tier ceiling:

- -200 or better: no price ceiling;
- worse than -200 through -499: maximum `Lean`;
- -500 or worse: maximum `Watchlist`.

The ceiling cannot produce `No Play`. It does not alter side, probability, projection, evidence adjustment, exact price, EV, stake, or `bet` / `shop` execution status. Spread, total and plus-money confidence are outside its scope.

## Boundary and regression tests

Focused fixtures prove:

- -200 retains an uncapped `Best Angle`;
- -201 and -499 cap an otherwise identical `Best Angle` at `Lean`;
- -500 and -4000 cap it at `Watchlist`, never `No Play`;
- an otherwise identical -500 spread remains `Best Angle`;
- the existing UMass +29.5 continuous-evidence promotion remains `Lean`;
- an ordinary unfavorable quote still changes only execution to `shop` and does not erase confidence.

Focused CFB holistic-confidence, market/sharp-aware, and full production-contract suites pass.

## Current-board impact

Comparator generated at 2026-09-04T22:14:34Z from the latest complete snapshot for each of eight ET-day games (21 evaluated markets):

| Matchup | Market | Price | Model probability | EV | Before | After | Execution |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Fresno State at USC | USC moneyline | -2200 | 87.23% | -8.80% | Best Angle | Watchlist | Shop |
| North Carolina A&T at Georgia State | Georgia State moneyline | -4000 | 96.01% | -1.59% | Best Angle | Watchlist | Shop |
| Toledo at Michigan State | Michigan State moneyline | -395 | 60.91% | -23.67% | Best Angle | Lean | Shop |
| Miami at Stanford | Miami moneyline | -3000 | 90.06% | -6.93% | Best Angle | Watchlist | Shop |

Board counts change from 4 Best Angles / 7 Leans / 5 Watchlists / 5 No Plays to 0 / 8 / 8 / 5. Confidence-actionable rows change from 11 to 8; seven remain `bet` and one remains an actionable `shop`. This is the disclosed and intended consequence of moving the three -500-or-worse favorites to Watchlist. There are zero changes outside moneyline, zero promotions, zero side flips, and zero probability, projection, price, EV, or stake changes.

The existing continuous evidence path remains promotion-capable and its UMass regression fixture remains green; this change does not manufacture replacement promotions to hide the intended removal of severely priced favorites from actionable tiers.

## Operational safety

The change uses the existing sole CFB writer and sport-scoped `prediction_pipeline:cfb` lease. Immutable T-60 records remain release-stamped and are never rewritten. The prior release remains the rollback path. Final acceptance still requires `npm run verify:model-change`, integration safety against the latest protected main, protected PR checks, deployment success, and a coherent natural-writer/member-snapshot observation carrying the r56 release identifiers.
