# NHL market-reader functional consequence — predeclaration

## Owner request

The owner requires the NHL Daily Edge product to work as a unified product now:
the independent model stays market-free, while qualified market evidence must be
interpreted and must have an auditable consequence for unlocked final scores,
picks, probabilities, and grades. This is a functional product correction, not
a claim of improved future accuracy and not a long retrospective search.

## Reproduced production defect

Release `nhl_regular_2026_r23_owls_current_odds` recognizes only one numerical
Moneyline consequence: a strong current market favorite that conflicts with the
independent winner may replace it when movement and splits point the same way.
The same qualified evidence is labeled `confirmed` when it agrees with the
independent side but changes no score or grade. Heavy split pressure opposed by
same-book price movement (market resistance) is discarded. The puck-line split
lane is displayed but is not passed to the model, so it cannot qualify a grade.
The Total path also contains graduated `0.35`, `0.65`, and `0.8` authority
weights, contrary to the requested categorical interpretation contract.

On the November 3 unlocked board, the current release labels 3 of 11 games
confirmed and 8 independent, flips none, changes Moneyline margins by at most
0.0143 goals, changes ten of eleven Totals by zero, and publishes eleven +1.5
puck-line selections. This establishes the functional baseline; settled-result
accuracy is not used to choose the repair.

## Candidate contract

1. Preserve the independent score and every locked payload exactly.
2. Classify complete, same-book Moneyline movement plus trusted complete splits
   as `confirmation`, `resistance`, or `unresolved`. The price response owns the
   directional read: movement with pressure is confirmation; movement against
   pressure is resistance. Circa/Pinnacle/Bookmaker are selected first and
   retained as named-source evidence; a broad-book fallback remains usable only
   at a stricter materiality threshold. The complete same-book history must
   also show a stable path; buyback, reversal, or flat paths are unresolved and
   receive no authority. No favorite default exists.
3. Apply a qualified Moneyline price response as an innovation from the
   independent win probability. Do not average the independent probability with
   the current market level. Re-solve one coherent score tuple from that result.
4. Pass the spread split lane into the model. It may promote a matching
   Watchlist to Lean or demote an opposed Lean/Best one tier only when complete
   trusted split evidence and the same exact puck-line price response agree.
   It does not create a second score or override the coherent Moneyline/Total
   score law.
5. For Total, a complete target-excluded board with a named professional book
   may select its coherent Total candidate. A retail-only board, or a named
   sequence opposing the endpoint, fails closed to the independent Total. No
   fractional authority or raw line-movement weight remains.
6. Missing, incomplete, low-confidence, or internally mixed evidence has zero
   numerical and grade authority.

## Required proof before publication

- focused confirmation, resistance, unresolved, spread promotion/demotion,
  and categorical Total tests;
- exact current-board before/after score, pick, grade, promotion/demotion, and
  actionable-count report;
- writer skip and reader precedence proof for locked rows;
- `npm run verify:model-change`, focused NHL tests, clean latest-main ancestry,
  integration-safety verification, protected pull request, and post-merge live
  release/board/lock verification.

The candidate must be rejected or revised if it silently flattens the board,
turns every qualified read into a favorite, changes locked records, adds a
second writer, or cannot explain every numerical consequence from stored input.

## Functional result

The exact November 3 production-input rehearsal completed 11 games / 33
markets with zero errors and zero missing prices. It classified four
Moneyline confirmations, two resistance reads, and five unresolved reads. The
six qualified reads changed one coherent score tuple in the direction of the
same-book price response. There are no favorite defaults: the candidate keeps
Utah, Anaheim, Dallas, Colorado, St. Louis, Minnesota, and Carolina as away
Moneyline winners while also retaining home winners where the independent and
qualified evidence support them. The board contains both Over and Under picks.

Relative to the exact unlocked r23 board, there are zero pick changes, two
grade promotions, two grade demotions, and an unchanged 20-actionable count.
Candidate price-aware counts are 0 Best Angle / 20 Lean / 13 Watchlist / 0
Pass. The current puck-line board contains four qualified stable reads (one
confirmation and three resistance reads); two other apparent endpoint moves
are correctly rejected after the complete path exposes buyback. The qualified
spread lane produces symmetric promotion/demotion behavior and never creates a
second score. No fabricated action was added to today's board.

This is functional qualification only. The current r23 release has no settled
forward games, so neither the incumbent nor this candidate has a release-pure
future-accuracy claim. Future results must be evaluated by the exact r24
release and lock timestamp.
