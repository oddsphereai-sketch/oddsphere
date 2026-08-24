# NFL Week 1 grading tiers predeclaration

Date: 2026-08-24

## Scope and unchanged release boundaries

This protocol tests two presentation-grade tiers around the active NFL Week 1 release. It does
not change the qualified r10 discrete joint PMF, representative score, moneyline/spread/total
probabilities, r6 exact-price probability model, r6+r10 direction-coherence requirement, current
price selection, stake, tracking boundary, writer, lease, or provider budget.

The active baseline is frozen before this audit:

- an r6 exact-price moneyline qualifier in the bounded `-300` through `+300` range is a `Lean`
  only when its selected team is the r10 conditional PMF winner;
- a coherent nonqualifier is `No Play`;
- a real identity, timestamp, quote, quarterback-history, injury, or market-completeness failure
  is `Held`;
- spread and total remain predicted from r10 and remain `No Play` because no exact-price action
  lane has qualified;
- no quota or forced minimum applies. Every count remains an output.

Historical inputs are limited to the timestamp-valid opening offer, the leave-one-market-side
fair comparator already used by r6, the r6 probability/EV/edge, and the r10 PMF derived solely
from its frozen pregame football features. Final results and closing lines are evaluation fields
only. No final injury, starter, weather, split, or game result enters a candidate rule.

## Frozen chronology

- 2021–22: retain the existing r6 fit and r10 football-state fit.
- 2023: select one Best Angle subgroup and one Watchlist boundary width.
- 2024 and 2025: open once as chronological confirmation and report each season separately.

The earlier NFL work has already inspected these seasons. This audit is a disciplined tiering
test over a fixed live lane, not a claim that 2024–25 are pristine never-seen holdouts.

## Best Angle candidate family

Best Angle eligibility is a strict subset of the existing direction-coherent r6 Lean cohort. It
can never create a new actionable bet or flip a side. Candidate thresholds are the Cartesian
product of:

- minimum exact-price EV: `2%`, `4%`, `6%`, `8%`, or `10%`;
- minimum r6 edge over the other-books consensus fair probability: `1`, `2`, `3`, `4`, or `5`
  percentage points.

All candidates retain the existing bounded price range, r10 winner agreement, and no weekly
cap. A candidate is selection-eligible only with at least 18 actions, action in at least 35% of
2023 weeks, positive units after removing its largest win, and positive mean normalized CLV.
Among eligible candidates select, in order: most units after removing the largest win, highest
mean CLV, highest ROI, more actions, then the stricter EV and edge thresholds.

The selected subgroup may ship as Best Angle only if untouched 2024 and 2025 confirmation has:

- at least 24 pooled actions and at least 8 in each season;
- positive units and ROI in each season;
- positive units in each season after removing the largest win;
- positive mean normalized CLV in each season;
- pooled positive-CLV frequency of at least 40%;
- a 20,000-draw week-cluster bootstrap probability of positive units of at least 90%; and
- a pooled bootstrap 95% ROI lower bound above zero.

Failure retains every existing Lean and authorizes zero Best Angles. It does not demote or
remove a Lean.

## Watchlist candidate family

Watchlist is explicitly non-actionable. It cannot carry a stake, enter tracking as a bet, or
replace a Lean/Best Angle. It is available only on a healthy moneyline that is currently No Play
for one of two bounded reasons:

1. **Direction disagreement:** the r6 tuple clears its exact-price Lean thresholds but selects
   the opponent of the r10 conditional PMF winner. The public side remains the r10 winner; the
   disagreement is not hidden or reader-side flipped.
2. **Near boundary:** the r6 best tuple selects the r10 winner, remains inside `-300` through
   `+300`, misses at least one Lean threshold, and stays within a selected symmetric boundary
   width. The frozen widths are `(EV, edge pp)` = `(-1%, -1pp)`, `(-2%, -2pp)`, or
   `(-3%, -3pp)`, with both floors required.

Every Watchlist family includes direction disagreements plus one near-boundary width. Select
the narrowest width producing at least 12 Watchlists across at least 25% of 2023 weeks. This
selection uses counts only, not outcomes or returns.

The selected Watchlist definition may ship if 2024–25 confirms at least 12 pooled rows, at least
five per season, zero overlap with Lean/Best Angle, complete bounded timestamped prices, and 100%
public-side agreement with the r10 PMF winner. Record, units, ROI, mean CLV, CLV+ frequency, and
week-cluster bootstrap are reported as diagnostics, not profitability gates, because Watchlist
is not a bet recommendation.

## Required board and safety reporting

Report old versus new uncapped counts by grade and market, exact Week 1 evaluated prices for all
promoted Best Angles and Watchlists, Best Angle promotions, actionable demotions, net actionable
change, and Held reasons. Any live behavior requires new immutable decision/member release IDs,
the existing single leased writer, focused and full model tests, `npm run verify:model-change`, a
production build, integration-safety verification on current main, and post-deploy live proof.
