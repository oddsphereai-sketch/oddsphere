# NFL Spread and Total pragmatic v1 predeclaration

Status: frozen before this task inspects any 2023 selection result or 2024-2025
confirmation result. This is a materially different candidate from the rejected
r1 exact-price policy; its primary gate is calibrated forecast conviction.

## Product and release scope

- NFL regular-season full-game Spread and Total only.
- Preserve the qualified r10 discrete joint PMF, representative scores, market
  sides, and probabilities. Do not refit the forecast on betting returns.
- Preserve the active r6+r10 Moneyline grades and Watchlists exactly.
- Preserve the existing single `nfl-forward-evidence` writer, shared
  `prediction_pipeline:nfl` lease, provider budgets, T-60 boundary, tracking
  disabled state, and zero stake policy.
- No quota, forced minimum, one-pick-per-week cap, or Week 1 tuning.
- A passed action lane is explicitly **provisional early-week v1**. It may
  authorize Lean without claiming certainty. Best Angle has a separate stricter
  gate. No stake inflation is permitted.

## Chronology and evidence integrity

- Policy selection: 2023 regular season only.
- Confirmation: 2024 and 2025, opened once after the policy freezes and reported
  separately and pooled.
- Exact opening line and two-sided price come from one target sportsbook. The
  target book is excluded from a same-line no-vig consensus of at least two
  other conventional books.
- r10 supplies win/loss/push mass at the target line. Exact EV is
  `p(win)*profit(price)-p(loss)`; conditional probability excludes pushes only
  when compared with the two-way fair price.
- Target price must be -130 through +130 and no more than one percentage point
  worse than leave-one-book-out fair probability. This permits a coherent normal
  quote without requiring it to be the slate's single best outlier.
- Opening quote must precede kickoff and all identity, line, price, PMF, and
  comparison fields must be complete. Historical final injury/QB/weather state
  and closing movement are excluded as unavailable at the opening timestamp.
- Closing movement is reported only as CLV. Forward publication additionally
  blocks an action when the existing same-book line moves more than 0.5 point
  adversely; missing/flat movement cannot manufacture a grade.
- Current forward health must pass the existing identity, quarterback-history,
  injury, market-completeness, and exact-quote checks. Projected-but-coherent
  starters and unavailable SharpAPI splits remain context, not automatic Holds.

## Conviction-first candidate family

Spread and Total select independent rules on 2023. The finite grid is:

- minimum r10 conditional probability: 55%, 57.5%, 60%, or 62.5%;
- minimum exact-price EV: 0%, 1%, or 2%;
- minimum r10 probability edge over leave-one-book-out same-line consensus:
  0, 1, or 2 percentage points;
- base forecast cushion: 0, 0.5, or 1 point.

Spread lines within 0.25 point of 3, 7, 10, or 14 require an additional 0.5
point cushion. Totals at or below 41 or at or above 50 require an additional
0.5 point cushion. These fixed penalties are not optimized.

One target offer per game/market is selected by highest exact EV, then price
advantage, then price, then deterministic sportsbook name. Count remains an
uncapped output.

### 2023 selection gates

All required:

- at least 18 actions and eight distinct weeks;
- positive total units and positive units after removing the largest win;
- pooled absolute calibration gap no greater than eight percentage points;
- at least two target sportsbooks;
- either positive mean CLV or positive-CLV frequency at least 45%.

Ranking is frozen: greatest units excluding the largest win, greatest units,
smallest calibration gap, greatest mean CLV, fewer actions, lexical rule ID.

### 2024-2025 provisional Lean gates

All required:

- at least 40 pooled actions and at least 15 in each season;
- positive pooled units and positive pooled units excluding the largest win;
- at least one season positive; the other season may be negative but not worse
  than -5% ROI;
- pooled absolute calibration gap no greater than eight points and neither
  season worse than twelve points;
- weekly-cluster bootstrap probability of positive units at least 65%;
- either non-negative mean CLV or positive-CLV frequency at least 45%;
- at least two target sportsbooks and no integrity failure.

The bootstrap interval is reported but its lower bound need not exceed zero.
Passing authorizes Lean only, under a new immutable provisional release.

## Non-actionable Watchlist

Watchlist remains untracked and unstaked. It includes a healthy direction-
coherent row outside an accepted Lean with:

- probability at least the selected Lean probability floor;
- cushion/key/zone requirements fully satisfied;
- exact EV at least -2% and model-consensus edge at least -2pp; or
- a meaningful model-consensus disagreement of at least 4pp with exact EV at
  least -3%.

The tuple must remain price coherent and bounded. Returns, CLV, calibration,
counts, and reasons are reported; no profitability claim is attached.

## Best Angle subgroup

Best Angle is tested only within an accepted Lean. Candidate subgroups add:

- minimum probability 60%, 62.5%, 65%, or 67.5%;
- minimum EV 4% or 6%;
- minimum model-consensus edge 3pp or 4pp.

Selection requires 12 actions, six weeks, positive units excluding the largest
win, calibration gap at most eight points, two books, and either mean CLV above
zero or CLV+ at least 50%.

Confirmation requires 30 pooled actions and ten per season, positive units in
both seasons, pooled and per-season largest-win-independent units above zero,
pooled ROI at least 3%, calibration gaps within the Lean limits, bootstrap
probability positive at least 80%, two books, and either mean CLV above zero or
CLV+ at least 50%. The ROI interval is reported but its lower bound is not an
absolute gate. Failure leaves every qualifying action at Lean.

## Required output and runtime boundary

Report exact uncapped 2023, 2024, 2025 and pooled W-L-P, units, ROI, largest-win
sensitivity, calibration, CLV, books, weeks, bootstrap, key/zone mix, and side
mix. Replay the latest authoritative Week 1 exact quotes and explicitly inspect
high-conviction examples such as MIA +3.5 and DEN +2.5 / Under 43.5 for any
probability-price semantic mismatch.

If a provisional lane passes, version decision, grade-policy, member, and
fixture releases, add focused runtime tests, and leave Moneyline/stakes/tracking
unchanged. If this conviction-first family fails, do not rename the rejected r1
policy; move to a materially different forecast/calibration architecture.
