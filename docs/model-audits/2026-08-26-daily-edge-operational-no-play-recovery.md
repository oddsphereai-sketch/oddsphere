# Daily Edge operational No Play and bounded MLB starter recovery

## Frozen scope and evidence

This release changes shared member presentation and MLB operational recovery
only. It does not change a probability, projection, side, evaluated quote,
writer grade, action, stake, tracking record, or lock. Internal `held=true`
remains the health signal; members see No Play plus the exact incomplete-data
reason and no fabricated evaluated quote. The model-owned outcome prediction,
probability, and projected score remain visible and distinct from Bet Grade.

The response boundary uses one universal forecast/grade separation contract.
Starter, lineup, identity, missing-feature, model-integrity, price-, sportsbook-,
split-, and consensus-only exceptions all preserve the already-produced model
outcome forecast. They withhold only the evaluated bet pick, fair probability,
edge, EV, evaluated price, actionability, and grade price. The member Bet Grade
is No Play in every case while internal recovery remains active.

At 2026-08-26T15:04:51Z, HOU@NYY (`external_id=5059773`) still had a null home
starter after the natural 14:05 slate cycle completed successfully at
14:08:27Z (2,307 records, 82 calls), and after later lineup cycles. The 14:35
health cycle incorrectly completed with zero findings/calls. This evidence was
frozen before implementation.

## Board migration

The stored 15:00:51Z MLB response contains 45 markets: 42 evaluated and three
internal HOU@NYY operational exceptions. Evaluated grades remain exactly 3
Best Angles, 12 Leans, 14 Watchlists, and 13 No Plays. The three exceptions
join the member-facing No Play filter, so the public count is 16 No Plays.
Promotions: 0. Demotions: 0. Actionable delta: 0. Probability/side/price
changes: 0. Locked mutations: 0.

## Recovery bounds

The scheduled health cycle uses the existing sport-scoped prediction-pipeline
lease. Starter-only recovery accepts only high-severity member exception rows
whose persisted reason names a starter gap, targets at most three exact game
external IDs, and passes those IDs into the canonical starter reconciler.
Provider work is slate-level and bounded to one MLB Stats request, one BDL
request when enabled, and at most two ESPN official-host attempts: four
requests maximum per eligible cycle, not per card. The health cadence plus a
30-minute minimum interval and shared lease provide cooldown and concurrency
idempotency. Starter-only recovery never invokes the prediction writer, even
when a mapped starter changes. The next normal leased writer cycle remains the
sole owner of any later prediction evaluation. The recovery cycle does not
publish a member snapshot: when starter evidence changes, the next normal
leased writer cycle owns both evaluation and coherent snapshot publication.
This prevents a repaired input from being paired with the prior held decision.
Provider availability and every per-side
source/mapping result are persisted in the normal health log summary; no
starter is guessed.

Rollback restores the prior presentation release and report-only periodic
health route. Internal held flags and historical locked rows require no data
rewrite.
