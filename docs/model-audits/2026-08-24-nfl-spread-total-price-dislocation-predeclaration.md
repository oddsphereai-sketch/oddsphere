# NFL Spread and Total price-dislocation predeclaration

Status: frozen after the r10 context calibrator failed confirmation, and before
any price-dislocation policy result is inspected.

## Material architecture change

The previous families treated r10 as the exact-price probability head. Their
out-of-sample failure shows that r10's public distribution probabilities are
not sufficiently calibrated to price Spread/Total bets directly.

This candidate separates the two axes:

- Public football forecast: unchanged r10 score, side, probability, and PMF.
- Bet-grade probability: the no-vig same-line consensus of at least two other
  conventional sportsbooks, excluding the target book.
- Exact-price value: consensus probability against the target book's exact
  offered price, preserving r10 PMF push mass.
- Independent model guard: target side must agree with r10 at the exact line,
  clear a frozen r10 probability/cushion floor, and pass key/zone sensitivity.

This is not target-market copying: the target book cannot contribute to its own
fair value, and consensus cannot create a play against r10. It is a market-led
price-dislocation lane analogous in role to the existing NFL Moneyline market-
led layer, with a separately visible independent football forecast.

## Chronology and integrity

- 2023 selects the policy.
- 2024 and 2025 confirm it separately and pooled.
- Week 1 is not used for selection or thresholds.
- Every row requires exact game identity, timestamp before kickoff, complete
  two-sided target quote, target price -130..+130, and at least two other books
  quoting the identical line.
- One target offer per game/market is chosen by consensus-derived exact EV,
  then target price advantage, then price, then sportsbook name. No quota.
- Historical closing movement is CLV evaluation only. Forward same-book movement
  more than 0.5 point adverse blocks action; unknown/flat movement cannot create
  action.
- Existing current identity, QB-history, injury, exact-quote, and market-health
  checks remain mandatory. True failure is Held; healthy nonqualifier No Play.

## Frozen policy grid

Spread and Total select separately:

- minimum r10 conditional probability: 50%, 52.5%, or 55%;
- minimum consensus-derived exact EV: 1%, 2%, or 3%;
- minimum target price advantage versus other-book fair: 1, 2, or 3pp;
- base r10 cushion: 0 or 0.5 point.

Spread key lines 3/7/10/14 and Total zones <=41/>=50 add the fixed 0.5-point
cushion penalty. r10 direction at the offered line is mandatory.

## Pragmatic Lean gates

2023 selection requires 18 actions/eight weeks, positive units and units after
largest win, consensus calibration gap <=8pp, two books, and mean CLV >=0 or
CLV+ >=45%. Rank by units excluding largest win, units, calibration, mean CLV,
fewer actions, lexical rule ID.

2024-25 provisional confirmation requires 40 pooled/15 per season, positive
pooled and largest-win-independent units, at least one positive season and no
season below -5% ROI, pooled calibration gap <=8pp and each season <=12pp,
bootstrap P(positive) >=65%, two books, and mean CLV >=0 or CLV+ >=45%. The CI
is reported and may cross zero. Passing authorizes Lean only; no stake increase.

## Watchlist and Best Angle

Watchlist is non-actionable and requires the selected r10 probability/cushion
floor, complete health, and a target price advantage within 1pp below the Lean
threshold or consensus EV within 2% below it. It cannot oppose r10.

Best Angle is tested only within an accepted Lean by adding price-advantage
thresholds 3/4/5pp and consensus-EV thresholds 4/6/8%. Selection requires 12
actions/six weeks, positive largest-win-independent units, calibration <=8pp,
two books, and mean CLV >0 or CLV+ >=50%. Confirmation requires 30 pooled/10 per
season, positive and largest-win-independent units in both seasons, pooled ROI
>=3%, calibration within Lean limits, bootstrap P(positive) >=80%, two books,
and the same CLV alternative. CI lower bound is diagnostic, not absolute.

## Runtime semantics

If qualified, the Bet-grade tuple must stamp r10 probability/side, other-book
fair probability and contributing-book count, exact target book/line/price/time,
consensus EV, price advantage, key/zone/cushion state, grade, and releases. The
reader must label the bet probability market-informed and retain the r10
football forecast separately.

Moneyline, scores, writer/lease, provider budget, locks, tracking, and stakes
remain unchanged. No Best Angle or action is forced.
