# NFL Spread and Total residual-blend predeclaration

Status: frozen after the conviction-first r2 family produced zero selection-
eligible rules, and before any residual-blend calibration or betting result is
inspected. This is a materially different probability architecture.

## Architecture

The qualified r10 discrete PMF remains the independent football forecast and
continues to supply the public score, side, and full outcome distribution. For
exact-price Spread and Total grading only, create a leave-one-book-out market-
informed probability:

`p = p_other_books + alpha * (p_r10 - p_other_books)`

where the target sportsbook is excluded from `p_other_books`. Alpha must be
nonzero, so the grade cannot collapse to target-price or consensus copying.

Spread and Total select alpha separately from 0.25, 0.50, 0.75, or 1.00 using
2022 only. Selection minimizes Brier score, then log loss, then prefers the
larger football weight. The alpha is frozen before 2023 policy selection. The
2022 output must report the pure r10 and other-book baselines beside the blend.
To prevent games with more target books from receiving extra calibration
weight, 2022 uses one deterministic representative exact-line row per game and
market: most other-book contributors, then smallest absolute target-versus-
consensus fair gap, then lexical sportsbook name.

The target exact price never enters the probability. It enters only afterward
to compute expected units. Target book identity remains excluded from the
same-line comparison consensus.

## Chronology

- Probability blend selection: 2022.
- Exact-price policy selection: 2023.
- Confirmation: 2024 and 2025, opened once and reported separately/pooled.
- Current Week 1 data never select alpha, thresholds, or gates.

## Exact-price policy family

Spread and Total are independent. The finite 2023 grid is:

- blended conditional probability floor: 53%, 55%, 57.5%, or 60%;
- target exact-price EV floor: 0%, 1%, or 2%;
- blend edge over other-book same-line consensus: 0.5, 1, or 2pp;
- base r10 forecast cushion: 0 or 0.5 point.

The target quote must be complete, before kickoff, -130 through +130, and no
more than one implied-probability point worse than other-book consensus. At
least two other conventional books must quote the exact line. Spread key lines
3/7/10/14 and Total zones <=41 or >=50 add the previously frozen 0.5-point r10
cushion penalty. One target offer per game/market is chosen by exact EV, then
price advantage, then price, then book name. There is no quota.

## Pragmatic provisional Lean gates

2023 selection requires at least 18 actions/eight weeks, positive units and
units excluding the largest win, calibration gap <=8pp, two books, and either
non-negative mean CLV or CLV+ >=45%. Ranking is largest-win-independent units,
units, calibration, mean CLV, fewer actions, lexical rule ID.

2024-2025 confirmation requires:

- at least 40 pooled actions and 15 per season;
- positive pooled units and pooled units excluding the largest win;
- at least one positive season and no season worse than -5% ROI;
- pooled calibration gap <=8pp and each season <=12pp;
- bootstrap probability positive >=65%;
- either non-negative mean CLV or CLV+ >=45%;
- two books and complete integrity.

The bootstrap ROI interval is reported but may cross zero. Passing authorizes
only a provisional Lean, with no stake or tracking change.

## Watchlist and Best Angle

Watchlist is non-actionable. Outside an accepted Lean it requires the selected
blend probability floor, full health/cushion/price coherence, and either EV and
edge >=-2%/-2pp or blend-consensus disagreement >=4pp with EV >=-3%.

Best Angle is tested only within an accepted Lean. It adds probability floors
60/62.5/65/67.5%, EV 4/6%, and edge 3/4pp. Selection requires 12 actions/six
weeks, positive largest-win-independent units, calibration <=8pp, two books,
and mean CLV >0 or CLV+ >=50%. Confirmation requires 30 pooled/10 each season,
positive and largest-win-independent units in both seasons, pooled ROI >=3%,
calibration within Lean limits, bootstrap probability positive >=80%, two
books, and the same CLV alternative. CI lower bound is reported, not absolute.

## Runtime and safety

The r10 public forecast remains visibly distinct from the market-informed Bet
grade probability. Any passed tuple must stamp the blend alpha, other-book fair
probability, exact target quote, r10 probability, EV, grade, quote timestamp,
and releases. Current same-book movement >0.5 point adverse blocks action.

Moneyline tiers, scores, writer/lease, provider budgets, stakes, tracking, and
T-60 behavior remain unchanged. Held is reserved for true data failure; healthy
nonqualifiers are No Play. If this family also fails, it must remain negative
evidence and a future continuation must change forecast/calibration inputs, not
simply lower these gates.
