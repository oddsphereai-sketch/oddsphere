# NFL discrete drive joint distribution predeclaration

Date: 2026-08-23

Status: frozen before the discrete scoring-event tournament and member-grade integration.

## Scope and ownership

This release may change the NFL Week 1 score display, moneyline/spread/total
probabilities, exact-price moneyline Bet grades, the stored forward-evidence
decision tuple, and the member reader. It may not add a writer, provider call,
timer, lease, stake rule, Best Angle lane, or tracking backfill. The existing
`/api/cron/nfl-forward-evidence` route remains the single authoritative writer
under the shared `prediction_pipeline:nfl` lease.

The already released football-only r1 point model supplies the away and home
expected-score centers. Sportsbook lines, prices, splits, movement, and the
target game's realized result remain excluded from the football forecast.
Market inputs enter only after the joint score distribution exists, when its
probability mass is evaluated at the exact offered line and price.

## Frozen discrete family

Every game is represented by one normalized joint probability mass function
over integer away/home scores. Conditional on a shared game-pace state, each
team receives a football drive count and an independent scoring-efficiency
state. A drive produces exactly one of:

- no score;
- safety, 2 points;
- field goal, 3 points;
- touchdown with missed conversion, 6 points;
- touchdown plus kick, 7 points;
- touchdown plus two-point conversion, 8 points.

The touchdown/field-goal/safety point shares, shared drive-count mixture, and
team-efficiency mixture are global parameters. The per-team scoring-event
probabilities are scaled to the frozen expected score without using a market
line. Candidate grids are declared in the operator before execution. The
lowest 2023 exact-score negative log score selects one configuration; parameter
or family selection cannot use 2024 or 2025.

The public score prediction is the highest-probability reachable joint score.
The public moneyline, spread, and total probabilities are all marginals of this
same probability mass. Moneyline probability is conditional on a non-tie;
spread and total probabilities are conditional on a non-push at the evaluated
line. Tie and push probability remain stamped in the model tuple.

## Chronology and gates

- Football point model: unchanged from the frozen r1 release.
- Discrete-family selection: 2023 only.
- Confirmation: 2024 and 2025, opened once after selection.
- Current structural check: the exact 16-game 2026 Week 1 artifact.

The discrete layer must satisfy every gate below:

1. Every score with nonzero probability is a nonnegative integer reachable by
   the declared scoring events, each game sums to one within `1e-9`, and all
   moneyline/spread/total probabilities reproduce from the same mass.
2. Exact-score negative log score is finite in each confirmation season and is
   no more than 0.05 worse than the predeclared neutral scoring-event baseline.
3. Moneyline Brier is below 0.25, log loss is below `ln(2)`, and ten-bin ECE is
   at most 10% in each of 2024 and 2025.
4. Empirical 80% margin and total intervals cover between 72% and 88% in each
   confirmation season.
5. The Week 1 modal team-score standard deviation is at least 2.0, modal margin
   standard deviation at least 3.0, and modal total standard deviation at least
   2.0. The board cannot collapse into one total direction.

Failure leaves the released r1 outcome package intact and keeps this candidate
out of the member reader.

## Frozen Bet-grade contract

The exact-price moneyline lane retains the already tested uncapped r6 policy
and thresholds; this task may not loosen them or impose a weekly quota.

- A coherent r6 exact-price qualifier is `Lean`.
- A coherent exact-price nonqualifier is `No Play`.
- Missing or ambiguous required identity, roster/depth, expected quarterback,
  quarterback history match, injury report, three-book leave-one-out market,
  pregame timestamp, or valid T-60 capture is `Held`.
- `projected` rather than `confirmed` starter status is visible context and is
  not by itself a Hold.
- SharpAPI absence is context only because Playbook public consensus and the
  exact named-book price remain separately labeled.
- No NFL Best Angle is authorized.
- Spread and total publish the distribution-derived side and probability but
  remain `No Play` until a separate chronologically validated exact-price lane
  passes. Missing required evidence still fails closed to `Held`.

Every public market stamps model probability, evaluated sportsbook, line,
price, quote time, fair probability, grade, evaluation time, and immutable
model/calibration/decision releases. Unlocked material quote changes require
the existing writer to refresh; a valid T-60 tuple freezes and later quotes are
context only.

## Required board comparison and verification

The audit must report exact Week 1 counts for Lean, No Play, Held, and Best
Angle, plus promotions/demotions versus the current all-Held Bet board. It must
also report the market mix and confirm that no minimum action count was forced.

Before publication: run the frozen tournament, deterministic runtime parity,
focused forward-writer/reader/tracking tests, `npm run verify:model-change`,
TypeScript, ESLint, a production build, `git diff --check`, and the concurrent
integration-safety guard from a clean current-main worktree.
