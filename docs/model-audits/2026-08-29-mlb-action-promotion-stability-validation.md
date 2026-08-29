# MLB r73 action-promotion stability validation

## Decision

Advance the writer-side persistence correction for unlocked MLB Moneyline
upward grade transitions. Do not advance the tested universal nonnegative-EV
demotion. The selected rule requires the same canonical candidate in at least
two distinct `game_predictions.computed_at` cycles and at least twenty elapsed
minutes. Retries or line-only refreshes with the same cycle ID do not advance
the state. A coherent book rotation does not reset it; side, market, normalized
line, or probability-head changes do.

The pending publication keeps its entire previous coherent public tuple,
including grade, reason, probability, evaluated price, and publication time.
The current candidate tuple is stored separately as bounded transition evidence
beside the persistence state; it does not partially replace the public tuple.
Existing resistance,
data-health, price-coherence, and lock rules demote immediately. Locked rows are
never evaluated by the new helper.

## Root cause and August 29 replay

HOU-NYM Moneyline remained No Play through `2026-08-29T17:16:30.939Z`,
then appeared as NYM Best Angle at BetRivers -148 from
`2026-08-29T17:19:28.192Z` through `17:46:45.102Z`, before returning to No
Play when the coherent evaluated quote rotated to Saba -149. The selected side,
model probability (about 57.92%), and target-excluded market fair probability
(57.315%) did not materially reverse. BetRivers aged across the 60-minute price
boundary; Saba's same-book movement and expected-value tuple missed the lower
Watchlist tolerances.

Under r73, the first Best Angle candidate remains the prior No Play. The next
observed candidate state arrived about fourteen minutes later, below the
selected twenty-minute window, and therefore remains pending. The candidate
then failed before the twenty-minute confirmation boundary, so the public
record never becomes Best Angle. This replay is post-selection confirmation;
August 29 was not used to select the duration.

## Chronological evidence

The SELECT-only audit covers 997 unique game/release observations, including
989 locked observations. It found 432 records with bounded public grade
history and 24 unique records containing a direct
`nonaction -> action -> nonaction` cliff. Across the retained histories there
were 183 measurable action runs that later returned to nonaction.

Duration selection used evidence through August 19:

| Window | Runs | Under 10m | Under 20m | Under 30m | Median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development + validation (through Aug 19) | 163 | 21 | 26 | 37 | 69.20m |
| Untouched holdout (Aug 20-28) | 20 | 1 | 2 | 3 | 93.07m |

Twenty minutes captures more short-lived transitions than ten while adding
only one holdout run; thirty minutes delays an additional holdout run with
limited incremental protection. Cycle identity is stricter than this
duration-only historical proxy because duplicate writes in one natural cycle
cannot count in production.

Historical snapshots did not persist every unchanged candidate on every
natural writer cycle. Therefore an exact counterfactual record/ROI for the
persistence rule cannot be reconstructed honestly. R73 records that missing
state prospectively by release; the audit does not pretend repeated public
history entries are distinct leased cycles.

## Rejected economics alternative

A universal nonnegative exact-price EV gate was tested and rejected. Across
367 historical locked MLB Moneyline actions (356 settled), the incumbent was
202-154, -3.169u, -0.89% ROI, Brier 0.24333, calibration gap -2.81pp. Keeping
only nonnegative-EV rows yielded 117-97, -3.824u, -1.79% ROI, Brier 0.24742,
and calibration gap -6.37pp. The 150 removed actions were 85-57, +0.656u; in
the untouched August 20-28 holdout, the removed cohort was 9-1, +4.797u
(+47.97% ROI), +3.912u after its largest win. This alternative is unstable
across chronological windows and cannot replace MLB's validated rule-specific
price economics.

The probability head, calibration, side, exact-price selector, and existing
grade thresholds therefore remain mathematically unchanged. R73 changes only
when an unlocked upward transition may become public.

## Promotion/demotion and board impact

- Eligible promotion: a candidate that remains qualified for two distinct
  natural cycles and at least twenty minutes advances to its existing model
  grade. This is the paired promotion path; there is no action quota.
- Pending promotion: retains the previous coherent lower grade/reason.
- Immediate demotion: existing adverse safety, health, coherence, side/line,
  or model-release changes remain immediate.
- Current frozen comparison: at audit time all August 29 MLB Moneyline rows
  were already locked, so r72-to-r73 current-board impact is zero promotions,
  zero demotions, zero side/probability/price changes, and zero locked writes.
- Prospective unlocked impact is transition-dependent and will be reported
  from r73 state, not inferred from reader polling.

## Load, ownership, and rollback

The implementation adds zero provider calls, zero database reads, zero writer
invocations, and no timer. It stores one bounded state object inside the same
atomic `prediction_records.snapshot_json` upsert. The existing authoritative
writer and `prediction_pipeline:mlb` lease remain unchanged.

Rollback is schema v5, decision r72, rule bundle v60, grade policy v50, and
Moneyline evaluation-price policy v2. Old and locked rows remain immutable.
