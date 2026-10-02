# NFL spread actionable-grade recalibration result

Date: 2026-10-02

Scope: NFL Daily Edge Spread grades only.

Writes during audit: zero.

## Decision

The predeclared grade-only candidate passes its selection, confirmation, current-board,
coherence, and non-flatness gates. It is eligible for publication through the protected release
process. This is a confidence-calibration repair, not a new score or prediction model, and its
opened sample is not a promised future win rate.

## Release-separated replay

The exact r23 replay artifact had SHA-256
`ecb8a201b928d0bd31c6e4be90d745e8f2662c7cc4eb4752c2d702e39bc06689`. The candidate requires
56.5% model probability for an actionable Spread and 59.0% for Best Angle, while retaining the
existing exact-price reliability, nonnegative-EV, nonnegative-edge, and cushion gates.

| Period | Candidate actions | Wins | Losses | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| Weeks 1-2 selection | 13 | 9 | 4 | 69.2% |
| Week 3 confirmation | 6 | 4 | 2 | 66.7% |
| Combined | 19 | 13 | 6 | 68.4% |

The combined Best Angle cohort is 8-2 across ten decisions. The combined Lean cohort is 5-4
across nine decisions. The candidate retains 19 of 47 settled Spread predictions (40.4%), so it
does not flatten the market. Results were already known when the replay was assembled; these are
opened diagnostics and must not be blended with future release-pure results.

## Current-board no-write proof

At the October 2 live-input no-write run, the writer collected all 15 still-unlocked Week 4 games
and all 45 markets, with zero held games, zero inserts, zero snapshot writes, and a 22-call maximum.
The immutable locked game remains in the member transition board.

The complete 16-game / 48-market board changes from 20 Best Angles / 7 Leans / 5 Watchlists /
16 No Plays to 17 / 5 / 10 / 16. Actionables move 27 to 22. Spread alone changes from
9 Best Angles / 3 Leans / 3 Watchlists / 1 No Play to 6 / 1 / 8 / 1. There are zero actionable
promotions, five actionable demotions, and one within-actionable Best-Angle-to-Lean move. The same
symmetric rule promotes any future unlocked Watchlist or No Play that clears every released gate;
focused boundary tests cover Watchlist-to-Lean and Lean-to-Best transitions. Moneyline and Total
grades are byte-for-byte unchanged for identical inputs.

Prediction sides, probabilities, expected scores, representative scores, market-reading evidence,
exact quotes, prices, stakes, provider calls, cadence, and member presentation are unchanged.
Locked tuples remain immutable. The board retains seven actionable Spreads and 22 total
actionables, clearing the predeclared six / 18 non-flat floors.

## Publication and rollback

The active release family is model r22 / calibration r21 / decision and grade r27 / member r25,
with writer r52, fixture r36, and compact snapshot r28. The model and calibration identifiers are
bumped even though their equations are unchanged so no behavior changes under an existing release
identifier. The joint-Moneyline r24/r26/r27 family remains an explicit transition predecessor for
immutable locks.

Roll back the complete October 2 release family if live verification loses a game or market,
changes a prediction or score, rewrites a lock, produces mixed current tuples, violates coherence,
or falls below the reviewed non-flat board floor.
