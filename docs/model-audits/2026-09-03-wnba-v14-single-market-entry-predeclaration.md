# WNBA v1.4 single-market-entry predeclaration

Date frozen: 2026-09-03 ET

Base: `35c42abd089038707000b00ffbf15deeb5d4915a`

Tree: `f0a1b2a3fd8df91442a662c8b1c66a4dab5af74f`

This declaration is committed before behavioral edits or outcome access in this
candidate worktree. The candidate remains local and held while the authentic WNBA
board is empty. Synthetic structural evidence cannot qualify production.

## Frozen defect and correction

WNBA v1.3 correctly excludes the evaluated Moneyline book and requires two
alternative books from two independent source families. For a cold-start team,
however, the target-excluded alternative probability enters twice inside the
incumbent calculator: first through the cold-start Elo prior and again through the
existing dynamic Moneyline blend. The duplicate path can pull independent underdog
support toward market plurality.

V1.4 removes only that duplicate use. The authoritative wrapper will compute the
post-sport-model probability from the same sport-owned Elo, recent scoring, form,
rest, cold-start sample/uncertainty and variance inputs as the exact independent
calculation. If qualified target-excluded Moneyline alternatives exist, their one
and only forecast entry is the established dynamic Moneyline blend, including its
existing reliability, model-stability, disagreement and conflict behavior.

The private incumbent calculator retains its existing cold-start market-prior path
by default. V1.4 disables that path only for the already-qualified target-excluded
Moneyline call made by the authoritative wrapper. Missing, incomplete, tied,
singleton or correlated market evidence therefore remains exact independent
identity; it is never Hold or 0.5. No coefficient, threshold or quota is changed.

## Frozen invariants

- The evaluated Moneyline book is selected once from the independent side by the
  existing deterministic quote policy, excluded before inference, and repriced on
  the complementary side of the same pair if the posterior flips.
- Market authority remains at least two target-excluded complete books from at
  least two source families. Circa, Pinnacle and Bookmaker remain distinct
  originators; all non-originators remain one conservative correlated family.
- Current pairs remain same-book, complementary, predecision, prestart, at most 15
  minutes old and at most 30 seconds skewed.
- The qualified target-excluded market probability enters the forecast exactly
  once. Spread may additionally use its distinct qualified target-excluded line
  evidence through the established 25/75 center; this is a different market
  constraint, not a second Moneyline probability blend.
- One maximum-entropy margin distribution preserves final Moneyline sign mass,
  final expected margin and incumbent variance. Spread probabilities derive from
  its CDF. Expected scores are the unrounded algebraic total/margin decomposition.
- Total projection/probability remains the independent sport-model Total normal.
- Exact evaluated price is downstream break-even/EV/grade economics only. Existing
  Best Angle/Lean/Watchlist/Caution vocabulary and thresholds are unchanged.
- Public evidence may resist a grade but cannot write the forecast or manufacture
  a Spread/Total action. Missing public evidence is neutral. Movement stays
  capture/display provenance and is not a v1.4 forecast input.
- `runWnbaModel` remains the sole writer; the shared `prediction_pipeline:wnba`
  lease, query/provider/write load, lock window and tracking ownership are
  unchanged. Locked v1 and v3 tuples remain immutable reader-first records.

## Candidate releases

- Model: `wnba_v1_4_single_market_entry`
- Distribution: `wnba_single_market_entry_2026_09_03_v6`
- Calibration schema: `wnba_core_calibration_v4_single_market_entry`
- Grade policy: `wnba_grade_policy_v9_single_market_entry_2026_09_03`
- Decision tuple: `wnba_decision_tuple_v4_single_market_entry_2026_09_03`
- Prediction record: `wnba_prediction_record_contract_v6_single_market_entry_2026_09_03`
- Forward action evidence: contract/key v3, reset by release rather than blending
  v1.3 observations into v1.4.

The target-excluded decision contract remains v2 and the behavior-neutral forward
capture contract remains v1. The calibration formulas, flags and 25/75 Spread rule
are unchanged; the calibration schema bump records the changed upstream probability
era rather than introducing calibration math.

## Authorized files

- `docs/model-audits/2026-09-03-wnba-v14-single-market-entry-predeclaration.md`
- `docs/model-audits/2026-09-03-wnba-v14-single-market-entry-result.md`
- `lib/services/wnba/buildWnbaDailyEdgePreview.ts`
- `lib/automodel/wnbaChampionRuntime.ts`
- `lib/automodel/wnbaCoreModelCalibration.ts` (schema stamp only)
- `lib/services/wnba/wnbaDecisionTuple.ts`
- `lib/services/wnba/buildWnbaPredictionRecords.ts`
- `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- task-owned focused WNBA tests.

No shared registry, shared safety assertion, UI, route, provider, cron, lease or
publication file is authorized. Root owns later coordinated changes to
`docs/current-model-releases.md`, `scripts/test-mlb-pipeline-safety.ts`, and
`scripts/test-daily-edge-experience.ts` after a nonzero natural gate and overlap
review.

## Frozen tests and hold gate

Synthetic tests will prove:

1. qualified target-excluded ML evidence changes final probability through exactly
   one dynamic blend while post-cold-anchor sport probability equals the independent
   sport probability;
2. missing/singleton/correlated evidence is exact independent identity and may
   still use a genuine evaluated singleton for downstream positive EV;
3. evaluated-price perturbation with fixed identity has zero forecast effect;
4. ML sign mass, Spread CDF, margin and decimal scores are one distribution;
5. Total projection/probability is exact independent identity;
6. existing exact-price thresholds produce both promotion and demotion paths;
7. calibration formulas/flags are unchanged apart from the schema stamp;
8. new unlocked tuples/records use v4/v6 while locked v1 and v3 tuples retain exact
   precedence; writer lock skipping and the sole leased path are unchanged.

The local candidate is held unless a naturally scheduled release-pure v1.4 replay
has nonzero games, exact target/evidence coverage, coherent probabilities/scores,
and naturally occurring grade counts including promotion and demotion opportunity.
No board, outcome, ROI or accuracy result is invented from the current zero slate.
