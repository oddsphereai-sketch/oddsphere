# NFL professional market-reading standard

Status: frozen NFL audit and implementation standard.

Date: 2026-10-09

## Research boundary

The market is an information-bearing probability and price system, not an oracle and not a vote count.
Bookmaker odds are generally strong forecasts, but efficiency and bias vary by market, horizon, season,
and market structure. Therefore OddsSphere must test a signal at the price and time at which members can
act; it may not treat a move that correctly revised an opener as proof that the moved side still has value
at the later quote.

Primary research supporting this boundary:

- Levitt's bettor-level professional-football data show that handle, prices, bettor preferences, and
  bookmaker shading are distinct; a bookmaker need not simply balance money. This rules out interpreting
  lopsided splits as automatic truth: https://www.nber.org/papers/w9422
- Simon's 3,681-game, four-sportsbook intraday study evaluates forecast reliability at several lead times
  and finds mostly reliable prices alongside narrower profitable patterns. Timing and book identity must
  be retained, not collapsed into open/close alone: https://doi.org/10.1287/mnsc.2022.00456
- Fodor, Krieger, Kirch, and Kreutzer find that NFL Moneyline information can add to the coarser point-
  spread market. Moneyline and Spread must be evaluated jointly near pick'em and short spreads rather than
  treated as independent decorations: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2047243
- Berkowitz, Depken, and Gandar find NCAA sides pricing becomes more accurate when more betting lines are
  available. Multi-book breadth is information, while a single selected book cannot stand in for the
  market: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2024252
- Shank finds NFL Spread and Total inefficiencies are market-specific and nonlinear. NFL Total evidence
  cannot borrow validation from Spread or Moneyline: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3022567
- Dare, Gandar, Zuber, and Pavlik distinguish explained noise trading from unexplained line movement
  associated with informed betting in college football. Movement needs news/context and sequence
  classification; magnitude alone cannot be labeled sharp: https://ideas.repec.org/a/taf/apfiec/v15y2005i3p143-152.html
- Buchdahl and colleagues' market-structure results show that favorite-longshot bias can arise from
  competition and heterogeneous beliefs rather than a simple public-versus-sharp story. No-vig probability,
  hold, and cross-book dispersion must be separated: https://doi.org/10.1093/oep/gpaf023
- Recent NFL key-number research documents discontinuous demand when spreads cross 3 and 7. Crossing a key
  number is economically different from the same raw half-point elsewhere, but demand discontinuity is not
  by itself outcome proof: https://doi.org/10.1016/j.frl.2026.110193

## NFL evidence ontology

Every signal must retain these identities before it can affect a forecast:

1. event and market: exact NFL game, Moneyline, Spread, or Total;
2. sportsbook family: normalized but never merged across books;
3. quote time: provider observation time, not job time;
4. number: Spread or Total point; Moneyline has no point number;
5. both side prices and no-vig probabilities;
6. raw hold and hold change;
7. source class: named price book, retail price book, public consensus split, named-book split, retail-book
   split, or unknown-book split;
8. split denominator status: percentages without ticket count, handle, and limits remain relative shares,
   not evidence of bet size;
9. action time: the immutable member lock; later evidence is prohibited.

Absolute handle, ticket count, average bet size, limits, originating market, syndicate identity, injury-
news time, and suspend/reopen lifecycle remain unavailable unless actually collected. They cannot be
reconstructed from percentages or price movement.

## State sequence

For every sportsbook/market trail, the reader must preserve opening, every retained material observation,
and the lock endpoint, then derive:

- first material price and number move and their order;
- current direction and continuous magnitude;
- persistence measured after the first material directional move;
- material reversal depth, complete buyback, and last economic move;
- time from named-lead completion to the lock;
- retail follower order and delays after both named leaders;
- NFL Spread crossings of pick'em, 3, and 7;
- price-only movement at the same number, number movement, and hold change as separate states;
- multi-book agreement, dispersion, and stale/lagging books;
- split alignment, opposition, reverse flow, and flow resistance.

There is no universal hard threshold that turns ordinary movement into sharp money. Thresholds are data-
quality gates; direction and strength remain continuous and are evaluated in neighborhoods around every
boundary.

## Signal hierarchy

The NFL reader evaluates, without collapsing them:

1. target-excluded current no-vig market price;
2. same-book opening-to-lock movement;
3. two named price leaders and subsequent retail following;
4. multi-book consensus displacement and dispersion;
5. source-identified money-ticket gaps;
6. resistance: flow without price response, price against flow, named/retail disagreement, or buyback;
7. Moneyline/Spread joint state, especially pick'em through three points;
8. Total state independently;
9. known injury/quarterback/weather timing when captured, without retroactive attribution.

Circa and Pinnacle are the named price books currently collected. Bookmaker has no authority until it is
actually captured. A SharpAPI record is not automatically sharp: its `sourceSportsbook` owns its class.

## What must be scored

Each signal family is scored in two distinct ways:

- information quality: whether the move improved the market's estimate from the opening and whether its
  direction matched the realized margin, winner, or Total change;
- actionable residual value: whether the indicated side beat the exact lock quote after the information
  was already incorporated.

Report coverage, W-L-push, Brier/log loss where probabilities exist, calibration, exact-price units,
opening-error improvement, timing bins, source counts, magnitude neighborhoods, key crossings, conflicts,
and uncertainty intervals. Report every correction and harm, not just aggregate accuracy.

The market-only audit spans all locks with usable history regardless of independent-model version. The
combined-product audit is stratified by historical independent release and separately replayed on the
current release. Releases may not be blended and presented as current-model performance.

## Marriage to the independent score

Market evidence may confirm, reduce, or reverse the independent margin or Total. A genuine reversal may
move the projected score materially, but one final joint distribution must own score, Moneyline, Spread,
Total, probabilities, and grades.

Market direction and conviction are separate. A contrary side cannot inherit the independent side's
probability by reflection around 50%. The selected-side probability must be supported by target-excluded
price and validated residual market evidence. Moneyline and Spread may jointly authorize an outright
winner change; Spread alone may not silently rewrite Moneyline. Total never borrows side authority from
winner markets.

No signal ships merely because it sounds sharp or improves an opened aggregate. Publication requires:

- a frozen predeclaration and chronological/release-pure evaluation;
- a correction/harm ledger and threshold-neighborhood audit;
- a tested promotion path for any actionable demotion;
- no hidden flat-board effect;
- locked writer and reader immutability;
- one writer and the shared sport lease;
- explicit owner approval and post-deploy release/data verification.
