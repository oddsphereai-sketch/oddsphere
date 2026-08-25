# NFL Spread and Total context-calibrator predeclaration

Status: frozen after the linear residual blend r3 produced zero 2023 selection-
eligible rules, and before any context-calibrator result is inspected.

## Material architecture change

Replace the single global blend weight with a regularized probability
calibrator. The calibrator is market-informed but target-price independent. Its
inputs are available at the decision timestamp:

- leave-one-target-book same-line consensus logit;
- r10-minus-consensus probability residual;
- signed r10 cushion at the offered line;
- selected-side indicator;
- fixed Spread key-number or Total extreme-zone indicator;
- for the context recipe only, residual-by-key/zone and cushion-by-key/zone
  interactions plus absolute offered line on a fixed scale.

No target sportsbook probability, target exact price, result, closing line,
future movement, final injury state, or Week 1 row enters the calibrator.

## Chronology

- 2022 weeks 1-12: fit candidate calibrators.
- 2022 weeks 13-18: select recipe and regularization by Brier, then log loss,
  then simpler recipe, then stronger regularization.
- Refit the frozen recipe on all 2022 rows.
- 2023: exact-price policy selection only.
- 2024 and 2025: confirmation, separately and pooled.

One deterministic calibration row per game/market uses most other-book
contributors, then smallest absolute target-versus-consensus fair gap, then
lexical sportsbook. This prevents book-count weighting.

## Frozen calibrator family

Separate Spread and Total models. Recipes:

1. `residual_linear`: consensus logit, r10 residual, r10 cushion, selected-side
   indicator, key/zone indicator.
2. `residual_context`: all linear inputs plus absolute line scale,
   residual-by-key/zone, and cushion-by-key/zone.

Logistic L2 inverse-regularization `C`: 0.03, 0.10, 0.30, or 1.00. Inputs other
than the consensus logit are standardized from the fit partition only.

The selected calibrator must retain a nonzero standardized r10 residual or
cushion coefficient and move probabilities from consensus by at least 0.25pp
on average in the 2022 validation partition. Otherwise the market is rejected
as consensus copying.

## Exact-price tiers

After probability freezes, use the same pragmatic v1 grid and risk-adjusted
gates predeclared before r2:

- probability floor 53%, 55%, 57.5%, or 60%;
- target exact EV floor 0%, 1%, or 2%;
- calibrated edge over other books 0.5, 1, or 2pp;
- r10 cushion floor 0 or 0.5 point, plus the fixed 0.5 key/zone penalty;
- target quote -130..+130, before kickoff, at least two identical-line other
  books, and no more than 1pp worse than other-book fair.

2023 Lean selection requires 18 actions/eight weeks, positive units and units
without largest win, calibration gap <=8pp, two books, and mean CLV >=0 or CLV+
>=45%. 2024-25 provisional confirmation requires 40 pooled/15 per season,
positive pooled and largest-win-independent units, one positive season and no
season below -5% ROI, pooled calibration <=8pp and per-season <=12pp, bootstrap
P(positive) >=65%, two books, and the same CLV alternative.

Watchlist and Best Angle semantics/gates are identical to the committed
pragmatic v1 predeclaration. CI lower bounds are reported rather than absolute
Lean/Best Angle requirements; no stake or tracking change is permitted.

## Safety

The public r10 score, side, and PMF probability remain visible as the football
forecast. If this calibrator passes, Bet grade must explicitly expose a
market-informed calibrated probability and exact evaluated tuple; it must not
silently replace or relabel r10. Moneyline, writer/lease, provider calls, locks,
tracking, and stakes remain unchanged. Held remains reserved for true health
failure; evaluated nonqualifiers are No Play.
