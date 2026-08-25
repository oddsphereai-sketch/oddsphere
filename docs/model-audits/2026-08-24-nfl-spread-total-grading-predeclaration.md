# NFL spread and total exact-price grading predeclaration

Status: frozen before the 2023 selection outcomes or 2024-2025 confirmation
outcomes are inspected by this task. This document is not a production release.

## Scope and unchanged authority

- Sport / slate: NFL regular season.
- Markets under test: full-game point spread and full-game total only.
- Forecast authority remains the qualified r10 discrete joint PMF and its
  calibrated cover/Over probabilities. The representative score, winner,
  margin, and total are unchanged.
- Moneyline authority remains the active r6+r10 grading policy, including its
  non-actionable Watchlist release. It is outside this tournament.
- The existing leased `nfl-forward-evidence` writer remains the only writer.
  Tracking, stakes, locks, provider budgets, and reader lifecycle are unchanged.
- No weekly quota, target action count, forced minimum, or Best Angle exists in
  the candidate definition.

## Chronology and leakage boundary

- Model/distribution family: already frozen before this audit by r10.
- Policy selection: 2023 regular season only.
- Confirmation opened once: 2024 and 2025, reported separately and pooled.
- Each historical decision uses the exact opening line and price from one target
  sportsbook. That target book is excluded from the comparison consensus.
- At least two other conventional sportsbooks must quote the identical point
  line. Target and comparison quotes must be complete, two-sided, uniquely
  matched to the game, and captured before kickoff.
- Closing lines and results are never inputs. Closing movement is reported only
  afterward as CLV. Historical injury/QB/weather/split revisions cannot be
  reconstructed at the opening timestamp and are therefore excluded rather
  than backfilled from final-week data.
- In forward production, the existing timestamp-valid identity, QB-history,
  injury, market-completeness, and exact-quote health checks remain mandatory.
  A genuine failure is Held. Projected-but-coherent QB context and unavailable
  SharpAPI splits are not automatic Holds.

## Common exact-price construction

For every target offer and market:

1. Evaluate both sides from the same r10 PMF at the target line, preserving push
   probability. The displayed side is the higher exact-price expected-value
   side; expected units are `p(win) * profit(price) - p(loss)`.
2. Calculate conditional model probability as `p(win)/(p(win)+p(loss))` for
   comparison with a two-way no-vig price.
3. Build the leave-one-book-out same-line no-vig consensus from at least two
   other books. The target book can never contribute to this consensus.
4. Require a bounded target price from -130 through +130 and a target price at
   least as favorable as the leave-one-book-out consensus for the selected side.
5. Define model edge as conditional model probability minus leave-one-book-out
   same-line fair probability. Define cushion as expected margin plus selected
   spread, or selected expected-total distance from the offered total.
6. Spread key lines are 3, 7, 10, and 14 points. A target line within 0.25 point
   of a key requires an additional 0.5 point of cushion. Totals at or below 41
   or at or above 50 require an additional 0.5 point of cushion. These penalties
   are fixed and not optimized.
7. Historical closing movement is not an eligibility input because it occurs
   after the opening decision. Forward publication additionally fails an
   actionable candidate closed when the existing same-book opening-to-current
   trail is materially adverse by more than 0.5 point; flat/unknown movement
   cannot create a play.

## Frozen Lean search

Spread and Total are selected independently. The finite 2023 grid is:

- minimum exact-price EV: 1%, 2%, 3%, or 4%;
- minimum leave-one-book-out probability edge: 1, 2, or 3 percentage points;
- base point cushion: 0.5, 1.0, or 1.5 points, before the fixed key/zone penalty.

Selection gates, all required:

- at least 18 actions and eight distinct weeks;
- positive units and positive units after removing the largest win;
- mean CLV greater than zero and positive-CLV frequency at least 50%;
- at least two target sportsbooks;
- ranking is frozen as: highest units without largest win, then total units,
  then mean CLV, then fewer actions, then lexical rule identifier.

Confirmation gates, all required before a live Lean:

- at least 40 pooled actions and at least 15 in each season;
- positive pooled units and positive units in both 2024 and 2025;
- positive pooled and per-season units after removing the largest win;
- positive pooled mean CLV and pooled positive-CLV frequency at least 50%;
- weekly-cluster bootstrap probability of positive units at least 90%;
- weekly-cluster bootstrap 95% ROI lower bound greater than -5%;
- at least two target sportsbooks and no price/identity/PMF integrity failure.

## Frozen Watchlist lane

Watchlist is non-actionable and cannot be tracked or staked. It uses the selected
market's Lean rule and includes a healthy price-coherent side that misses only
the EV/edge boundary within one of these nested widths, selected on 2023 by the
tightest width producing at least 18 rows across eight weeks:

- EV within -1% and edge within -1 percentage point;
- EV within -2% and edge within -2 percentage points;
- EV within -3% and edge within -3 percentage points.

The selected side must still agree with the r10 PMF direction at that line,
meet the full cushion/key/zone requirement, use a bounded complete same-line
multi-book tuple, and not overlap a Lean. Returns and CLV are diagnostics only;
they are not a profitability gate for this monitoring label.

## Frozen Best Angle audit

Best Angle is tested only inside an accepted Lean lane. Candidate subgroups add
EV thresholds of 4%, 6%, 8%, or 10% and edge thresholds of 3, 4, or 5 percentage
points. Selection requires at least 12 actions, six weeks, positive units after
the largest win, mean CLV above zero, positive-CLV frequency at least 55%, and
two books. Confirmation requires at least 30 pooled actions and ten per season,
positive units and largest-win-independent units in both seasons, mean CLV above
zero, positive-CLV frequency at least 55%, bootstrap probability positive at
least 95%, and a strictly positive 95% ROI lower bound. Failure leaves every
accepted action at Lean.

## Required reporting and release boundary

Report 2023, 2024, 2025 and pooled counts, W-L-P, units, ROI, largest-win-
independent units, CLV, books, weeks, bootstrap intervals, key/zone mix, and all
promotions/demotions. Replay the latest authoritative Week 1 exact prices and
show market-specific and full-board counts.

A failed Lean confirmation remains negative evidence and cannot change runtime
grades. A semantically valid Watchlist may ship without changing actionability.
Any production behavior requires new immutable decision, grade-policy, member,
and fixture releases, the full model-change suite, focused tests, production
build, and integration-safety verification on current main.
