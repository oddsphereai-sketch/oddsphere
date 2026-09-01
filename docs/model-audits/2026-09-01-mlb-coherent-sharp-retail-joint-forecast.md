# MLB coherent sharp-retail joint forecast — 2026-09-01

## Decision

Ship the versioned r76 MLB forecast as one coherent outcome pipeline for
Moneyline and full-game Total. The independent baseball projection remains
the structural input. A complete, fresh, exact-market price map becomes the
market input before the existing posterior produces decimal team scores,
probabilities, sides, and downstream grades. This is not a new writer, a
reader override, a synthetic split, or a quota for actionable plays.

First-inning remains on its existing market-backed probability head. Current
data has complete retail FI prices but no sufficiently broad supported sharp
pair, so this release does not pretend that the full-game evidence contract is
available there.

## Frozen contract

- Release: `mlb_daily_edge_decision_2026_09_01_r76_coherent_sharp_retail_joint_forecast`
- Schema: `mlb_model_layer_versions_v9_coherent_sharp_retail_joint_forecast`
- Calibration: `mlb_public_calibration_v28_coherent_sharp_retail_joint_forecast_2026_09_01`
- Rule bundle: `mlb_daily_edge_rule_bundle_v64_coherent_sharp_retail_joint_forecast_2026_09_01`
- Projection core: `mlb_projection_core_v2_3_coherent_sharp_retail_joint_forecast_2026_09_01`
- Grade policy: `mlb_public_grade_policy_v54_coherent_sharp_retail_joint_forecast_2026_09_01`
- Price-map contract: `mlb_coherent_market_price_map_v1_2026_09_01`
- Market policy: `mlb_model_market_calibration_v2_coherent_group_consensus_2026_09_01`

For each market and sportsbook, only a complete two-sided pair is de-vigged.
The two sides must be captured within two minutes of one another, and the
exact listed Total is required. Pinnacle, Circa, and Bookmaker form the
sharp cohort; supported consumer books form the retail cohort. At least two
books in each cohort must qualify inside the established 90-minute feature
freshness window. The median probability in each cohort is computed, then the
two cohorts receive equal group weight. This prevents a larger retail book
count from overwhelming the sharp cohort without treating any single book as
truth.

The group Moneyline probability determines the market run-share input. The
group Total probability is inverted through the same Poisson total model to
recover the market-implied scoring mean, including conditional non-push math
at integer totals. These enter the existing data-quality-adaptive posterior.
The resulting decimal home and away projections then feed the established
probability regularization and exact-price grade pipeline.

Fresh public ticket/handle evidence is not relabeled as a sportsbook price.
When its signed money-minus-bets direction materially contradicts the
sharp-retail price gap, the enhanced map is rejected for that market. Missing
or incomplete splits are neutral. Missing evidence never creates a Hold,
flattens a slate, or manufactures a pick; the existing market prior remains
the fallback.

## Frozen current-slate impact

Read-only audit on the September 1 slate:

- 15 games inspected.
- Moneyline coherent map applied to 11 games.
- Total coherent map applied to 6 games.
- 6 decimal score projections changed.
- 0 Moneyline direction changes and 1 Total direction change.
- 1 raw V2.2 Moneyline grade change and 0 raw Total grade changes.
- 0 split conflicts in the available current evidence.

The change does not target a board count. It shows that the evidence can move
a forecast when the joint read warrants it without promoting the whole slate.
The authoritative writer still owns exact offered-price economics, promotion
persistence, safety demotions, locks, tracking, and member publication.

## Release-separated chronological check

The read-only audit used settled games from August 25–31 and the latest locked
record per game/market, partitioning August 25–28 as selection and August
29–31 as later confirmation. Price observations were truncated at each locked
timestamp. Only games with the r76 evidence breadth were compared; no release
eras were blended.

The production equal-group prior improved Total Brier in both chronological
partitions. Moneyline Brier and team/total score MAE moved only slightly and
were mixed. Direction changes were rare. This is evidence that the integration
is proportionate, not proof of guaranteed wins. It also means this release
must not be described as an outcome- or ROI-optimized retrospective rule.

## Operational and safety boundary

- No provider call, database query, cron, table, writer, or lease is added.
- The price map is computed from rows already loaded by the authoritative
  feature snapshot.
- One `as_of` timestamp is frozen for the entire snapshot wave.
- Missing, stale, thin, malformed, or contradictory evidence falls back to
  the previous prior rather than withholding the projection.
- The writer remains `lib/services/predictionRecordService.ts` under the
  shared sport-scoped `prediction_pipeline:mlb` lease.
- Stakes, the r73 two-cycle promotion contract, immediate safety demotions,
  T-60 locks, and tracking are unchanged.

## Validation and rollback

Required checks are the focused coherent-price-map test, existing MLB V2.2
and feature-capture suites, MLB pipeline safety, `verify:model-change`,
TypeScript, focused lint, production build, diff check, integration safety,
and post-deploy live release/coherence checks.

Rollback restores r75 / rule bundle v63 / grade policy v53 / schema v8 /
calibration v27 and removes the coherent map from the V2.2 baseline. It does
not roll back the September 1 sharp Moneyline source recovery, the August 31
split-recency correction, or any shared price-evidence/UI foundation.
