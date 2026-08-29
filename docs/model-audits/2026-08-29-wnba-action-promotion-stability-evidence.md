# WNBA action-promotion stability: forward-evidence contract (2026-08-29)

## Decision

The WNBA production promotion gate remains disabled. This release collects bounded forward
chronology only and changes zero public grades, probabilities, projections, sides, exact evaluated
quotes, stakes, locks, tracking identities, release identifiers, or reader behavior.

The production-history audit found 525 WNBA `prediction_records` covering 173 games and 61 slate
dates from June 24 through August 29. None contains canonical grade history and none contains prior
action-promotion transition state. The current WNBA writer overwrites an unlocked record, while the
member snapshot store retains one current response per slate key. End-of-day snapshots cannot
reconstruct intraday natural-cycle transitions. Historical chronology is therefore insufficient to
select or validate a persistence threshold without tuning on incomplete evidence.

No promotion threshold is selected here. No MLB duration or cadence is copied into WNBA. Evidence
sampling follows WNBA's existing fixed natural schedule only: `:23` and `:53` UTC, a 30-minute
cadence. A production WNBA gate requires a separate, frozen chronological validation and untouched
holdout after enough natural-cycle evidence exists.

## Authoritative path and schema

Evidence is attached only by `buildWnbaPredictionRecords`, inside the existing WNBA daily refresh
and its required sport-scoped `prediction_pipeline` lease. There is no new table, query, writer,
cron, timer, provider call, or reader path.

The existing `game_predictions` query now includes its already-stored `computed_at` column. Its raw
value is retained as `source_computed_at` and normalized to a deterministic schedule-slot identity:
the interval is 30 minutes with a minute-23 UTC anchor. Times from `:23:00` through `:52:59.999`
map to the `:23` slot and `:53:00` begins the next slot. Thus whole-pipeline retries within one
scheduled interval cannot manufacture independent evidence. `published_at` and evidence
`captured_at` are not cycle identities.

Each unlocked `(game, market)` record may store:

- key: `wnba_action_promotion_evidence_v1`
- contract: `wnba_action_promotion_evidence_v1_forward_only_2026_08_29`
- mode: `shadow_only`
- production gate: `false`
- maximum observations: 32
- maximum serialized evidence bytes: 32,768; the byte cap may reduce the retained count below 32
- cadence interval: 30 minutes
- cadence anchor: minute 23 UTC

Every observation contains the normalized cycle, raw source-computed, and capture times; strict game and market identity; side and
normalized line, candidate grade/actionability, exact evaluated sportsbook/price/time, model and
market probabilities, outcome confidence, edge, offered-price EV, and the relevant model,
distribution, grade-policy, decision-tuple, and prediction-record releases. Strings are bounded to
160 characters.

The economic-equivalence key excludes grade/actionability, sportsbook, quote timestamp, capture
time, and cycle. It requires exact equality of game/market/side/normalized line, evaluated price,
model and market probabilities, confidence, edge, derived offered-price EV, and every relevant
release identifier. Thus a grade-only transition remains causally distinguishable from an economic
change, while a material side, line, price, probability, edge/EV, or release change resets economic
identity. A separate evidence identity retains grade/actionability, sportsbook, quote/source times,
cycle, and the economic key.

## Integrity behavior

- Retries at `:24`, `:33`, `:43`, and `:52:59.999` share the `:23` slot and are idempotent even if
  they observe different candidate inputs or have later capture times; `:53` begins the next slot.
- A stale or out-of-order schedule slot is ignored.
- Locked rows are removed from the write set before evidence attachment and remain immutable.
- Existing unrelated snapshot keys are preserved.
- The evidence collector does not mutate its candidate record.
- Evidence is namespaced and is not serialized into public tuple, grade, tracking, or reader fields.
- The oldest observations are removed first when either cap is reached.

Focused regression coverage proves same-slot retry idempotency, stale-slot rejection, monotonic
append behavior, exact economic equivalence for book and grade-only rotations, reset on price,
side, line, probability, and release changes, numeric external-ID preservation, count and
byte bounds, unrelated-key preservation, exact candidate/public-field immutability (including
publication and tracking identity), locked-row exclusion, and continued `vercel.json` ownership of
the `23,53` schedule.

## Baseline and impact

The pre-release SELECT-only operator audit reported:

- 525 prediction records
- 0 evidence rows and 0 forward observations, as expected before deployment
- 0 duplicate or out-of-order cycles
- current unlocked counts: four moneyline Watchlists, four total Watchlists, four spread Watchlists
- board impact: 0 grades, 0 probabilities, 0 sides, 0 stakes
- provider-call impact: 0

This forward evidence is necessary to evaluate the product-stability problem, but it is not a
claim that the eventual WNBA rule will match MLB's two-cycle/20-minute rule. Promotion and
demotion counts, transition duration, outcomes, units/ROI, calibration where applicable, day/game
cluster sensitivity, balanced actionable impact, and an untouched holdout must be reported before
any live WNBA behavior change.

Validation on the candidate completed with the focused evidence test, the 75-check WNBA core
suite, the 65-check pipeline/lease suite, `verify:model-change`, `verify`, TypeScript, focused lint,
and the webpack production build all green. The repository-wide lint baseline remains independently
red at 1,303 errors and 247 warnings; the three touched TypeScript files have zero lint errors and
zero warnings.
