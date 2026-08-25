# CFB generalized weekly engine predeclaration

Date: 2026-08-25

Status: frozen implementation and release contract before runtime scoring

## Defect and permitted scope

The qualified CFB v1 model is live for the eight-game August 29 opening slate,
but its production writer obtains both its collection window and its game IDs
from the eight baked forecasts in the current score artifact. It therefore
cannot discover or score the September 3-7 slate or any later weekly slate.
This is a production-continuity defect, not authorization to change the
qualified football model or exact-price grade thresholds.

This release may:

- discover the active Thursday-through-Monday CFB window from Eastern calendar
  time and collect every provider-scheduled game with at least one FBS team;
- materialize a portable, checksum-backed 2026 pregame team state from the same
  leakage-safe 2021-25 sources and feature builder used to qualify CFB v1;
- apply the existing elastic-net home/away heads and empirical paired residual
  distribution to a newly discovered matchup;
- retain the eight existing opening-week forecasts byte-for-byte as parity
  anchors and use the generalized scorer only for games outside that frozen
  slate;
- publish an independent forecast for every eligible scheduled game, while
  failing the exact-price grade closed when a named offer, target-excluded
  same-line consensus, or required lock health is unavailable; and
- scope collection cadence and member completeness to the active weekly window
  so immutable prior-week evidence remains stored without contaminating the
  current board.

It may not change model coefficients, imputer/scaler values, empirical residual
pairs, market calibrators, grade thresholds, stake behavior, T-60 timing,
tracking eligibility, provider labels, or the single `prediction_pipeline:cfb`
writer/lease. Market line, price, fair probability, splits, and movement remain
excluded from the independent score head.

## Frozen release identifiers

- score artifact: `cfb_v1_joint_score_artifact_2026_08_25_r3_weekly`
- model: `cfb_v1_independent_score_model_2026_08_25_r1` (unchanged)
- distribution: `cfb_v1_empirical_joint_score_distribution_2026_08_25_r1`
  (unchanged)
- probability: `cfb_v1_joint_market_probability_2026_08_25_r1` (unchanged)
- representative score: `cfb_v1_central_reachable_score_2026_08_25_r1`
  (unchanged)
- grade policy: `cfb_v1_composite_grade_policy_2026_08_25_r1` (unchanged)
- decision: `cfb_v1_daily_edge_decision_2026_08_25_r5_weekly`
- collector: `cfb_forward_evidence_collector_2026_08_25_r3_weekly`
- member: `cfb_v1_member_release_2026_08_25_r2_weekly`
- writer: `cfb_forward_evidence_writer_2026_08_25_r3_weekly`
- member fixture: `cfb_v1_member_fixture_2026_08_25_r2_weekly`
- weekly-window contract: `cfb_weekly_window_2026_08_25_r1`

The evidence schema remains
`cfb_forward_evidence_snapshot_2026_08_25_r1` because the immutable row shape
and database contract do not change.

## Frozen gates

1. The eight opening-week forecasts must retain identical expected points,
   margin, total, winner probability, representative score, intervals, and PMF.
2. A synthetic September 3-7 slate containing IDs absent from the old artifact
   must be discovered and scored without a static-ID allowlist; a later
   Thursday-through-Monday window must pass the same rollover test.
3. Every forecast's decimal points, margin, total, winner probability, Spread
   probabilities, and Total probabilities must be derived from one identical
   joint PMF. The representative score must have positive PMF mass, preserve a
   non-tie winner when the winner probability is not 50%, and remain within the
   existing centrality bounds.
4. The eligible slate is every scheduled game in the active window where at
   least one provider team is FBS. Missing named prices may hold Bet grades but
   may not delete the independent forecast or game card.
5. Provider pagination and QB-context calls must have explicit hard ceilings.
   Any budget excess, ambiguous team identity, malformed response, or partial
   context failure aborts before the single append.
6. Collection need, opening completeness, unlocked cadence, T-60 priority, and
   member completeness are evaluated only against the active weekly game set.
   Prior-week rows remain immutable and cannot inflate the current count.
7. Exact-price Moneyline, Spread, and Total decisions retain the current named
   target offer plus target-excluded same-line consensus contract. Bet count is
   an output; no quota or forced action is allowed.
8. Only a complete T-60 tuple captured no more than 20 minutes late is eligible
   for official tracking. No unlocked or prior-week row becomes tracked through
   rollover.
9. The generalized Week 0 replay must have zero grade promotions/demotions from
   the live release. Week 1 counts are reported as natural outputs of real
   available exact-price tuples, with incomplete tuples Held.

Deployment requires the focused rollover/parity/coherence/budget tests,
`npm run verify:model-change`, the production webpack build, a clean diff,
integration safety from fresh current main, protected PR checks, and read-only
verification after the next natural scheduled cycle. No manual production
provider, cron, writer, or database mutation is authorized.

## Implementation evidence

The frozen contract was implemented from base
`1d687335bc61cafe008eaec94eb6fee0e1af9cce` without changing the qualified
model coefficients, residual pairs, probability/calibration releases, grade
thresholds, T-60 boundary, tracking policy, or writer lease.

- The portable artifact contains 256 team profiles from 40 checksum-backed
  2021-25 source files. Its generated SHA-256 is
  `e55a74fe0e4d025d2d9aa8a4d3cb2ec8bdb50ae1ff23ccbbcfd7ca0ba7cd04d2`.
- All eight opening-week forecasts are deep-equal to the prior artifact,
  including every PMF cell. Their 24 market slots therefore retain the live
  **1 Best Angle / 2 Lean / 10 Watchlist / 8 No Play / 3 Held** result: zero
  promotions and zero demotions.
- A provider ID absent from the launch artifact generated a complete Alabama
  at Ohio State joint forecast of 14.15-30.98 expected points, +16.83 home
  margin, 45.13 total, 83.69% home-win probability, and a reachable 14-31
  representative score. Those are validation-fixture outputs, not a published
  game prediction or Bet grade.
- The same future forecast changed after a prior completed game was supplied,
  proving that exact pregame-known results update the qualified rolling/Elo
  feature contract rather than being ignored. Market fields do not enter that
  update.
- Week 0, September 3-7, and a later October window pass without a static ID.
  An FCS-at-FBS game remains eligible; a two-FCS game and an out-of-window game
  are excluded. Missing portable identity still receives an explicitly
  neutral-imputed independent forecast while all three exact-price grades are
  Held.
- The per-run QB queue is capped at 24 previously unseen team IDs, prioritizes
  T-60 games, and reuses immutable earlier context. Each selected team retains
  the two-page roster cap and the combined stats lookup retains its two-page
  cap. Prior exact game-result reads are capped at 1,200 IDs in 100-ID batches
  and feed only games completed before the forecast.
- The writer still performs one all-payload append after every provider/model
  dependency succeeds. Its route still owns exactly the
  `prediction_pipeline:cfb` lease. No parallel writer, client-side override,
  new table, migration, manual seed, cron invocation, or production mutation
  was added.

Validation completed locally:

- `npm run test:cfb-v1-production`
- `npm run verify:model-change`
- `npx tsc --noEmit`
- `npm run build` (Next.js 16.2.6 production build, 105/105 static pages)
- `git diff --check`

The September 3-7 provider slate and its exact-price grade counts intentionally
remain a natural forward output. This release makes that slate discoverable and
scoreable; it does not pre-call production providers, fabricate unavailable
prices, or relabel a validation fixture as authoritative Week 1 evidence.
