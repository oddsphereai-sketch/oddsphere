# MLB full-game structural coherence r80 predeclaration

Date frozen: 2026-09-02

Starting production authority: protected `main` `a7ee0905f7c225d41621440d0780c556512ede27`.
The active MLB full-game forecast is the r76 coherent sharp/retail joint
forecast. First-inning remains the separately versioned r79 release and is
outside this change.

## Question and non-negotiable boundary

This candidate tests two structural corrections, not a new coefficient search:

1. A complete Moneyline or Total price pair that is the only accepted named
   book for that market may provide the exact evaluated quote and downstream
   EV/grade economics, but it may not validate itself as forecast evidence.
   The final probability and decimal projection retain the independent/full-
   game posterior path for that market component. Missing split evidence is
   neutral.
2. `prediction_records` may grade or stand down an authoritative full-game
   forecast, but may not publish the opposite Moneyline or Total side while
   retaining the original upstream decimal score and PMF. Existing inversion,
   calibration, and residual rules may remain as internal candidate/provenance
   evidence; they cannot relabel the public forecast. A favorite becoming No
   Play is not an underdog prediction.

This candidate does **not** introduce a forced underdog rate, an arbitrary
market percentage, an outcome-fitted reversal rule, or a new broad market
interpreter. A future underdog reversal requires persistent, target-excluded,
source-diverse pregame evidence to change one upstream posterior, decimal
score, winner, and market sides coherently. The forward capture shipped in
PR #330 exists to qualify that later rule; it is not backfilled.

## Exact owned boundary

- `lib/automodel/mlbAutoModelV2_2.ts`
- `lib/services/predictionRecordService.ts`
- `lib/automodel/mlbModelLayerVersions.ts`
- `docs/current-model-releases.md`
- this predeclaration and its paired result note
- `scripts/operator/audit-mlb-fullgame-structural-coherence-r80.ts`
- `scripts/test-mlb-automodel-v2-2.ts`
- `scripts/test-prediction-record-service.ts`
- `scripts/test-mlb-pipeline-safety.ts`

Excluded: provider calls, feature-snapshot queries, coherent-map collection,
cron routes, writer ownership, the `prediction_pipeline:mlb` lease, database
schema, member readers/UI, locks, tracking, first-inning, props, and every
other sport.

## Frozen evaluation plan

The result report must keep prediction quality separate from exact-price
economics and grades.

1. Reconstruct only rows whose release identifiers and locked timestamps make
   the incumbent and candidate inputs truthful. Do not blend release eras.
2. Report model and market-favorite Brier score, log loss, calibration by
   market-implied favorite-probability bucket, favorite-selection rate,
   observed favorite win rate, upset recall/precision, and every model-versus-
   market disagreement. Small samples are descriptive, never tuning evidence.
3. Separately report exact-price grade promotions, demotions, unchanged rows,
   actionables, Best Angles, Leans, Watchlists, No Plays, side changes, and
   unit/ROI only where a valid locked exact-price outcome exists.
4. Run a same-input current-board replay and list every singleton forecast
   change and every publication-coherence repair. The candidate must not change
   a multi-book r76 forecast, a first-inning tuple, a locked record, a stake,
   or any query/provider/write count.
5. Focused fixtures must prove both Moneyline and Total grade promotion and
   demotion reachability on the retained authoritative side. A board flattening
   or one-way demotion mechanism fails.

## Acceptance gates

- A singleton evaluated pair has zero authority over the forecast posterior;
  its exact price still determines break-even probability and EV.
- A target-excluded/multi-book r76 input remains byte-identical.
- Final public Moneyline side matches the decimal-score winner and final Total
  side matches the authoritative upstream PMF; no downstream rule can create
  an opposite forecast label.
- Every locked/T-60 tuple remains byte-identical.
- Current-board actionables do not unexpectedly collapse; promotions and
  demotions are reported rather than targeted.
- Runtime releases are bumped together, registry and constants agree, and
  focused tests, `npm run verify:model-change`, TypeScript, changed-file lint,
  production build, diff check, and fresh-main integration safety all pass.
- Deployment acceptance requires one natural leased writer cycle with a
  coherent current member snapshot, the exact new releases, healthy odds and
  data coverage, no lock mutation, and no provider/query/write-topology delta.

Rollback is the complete preceding r79/r76 MLB release set. No old row is
rewritten or relabeled as current-release evidence.
