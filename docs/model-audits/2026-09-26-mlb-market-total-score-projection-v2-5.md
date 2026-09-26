# MLB market-total score projection v2.5

Date: 2026-09-26

## Scope

This release changes only the projected scores generated for future unlocked
MLB cards. It does not change a Moneyline winner or margin, Total side,
probability, confidence, grade, promotion, demotion, price, stake, provider,
member label/copy/layout, cron, writer, lease, lock, settlement, or historical
row.

The preceding projection core is
`mlb_projection_core_v2_4_evaluation_only_price_exclusion_2026_09_02`. The new
core is `mlb_projection_core_v2_5_market_total_preserve_margin_2026_09_26`.
The shared schema advances to
`mlb_model_layer_versions_v17_market_total_score_projection`. The existing
r89 decision, v35 public calibration, v4 Total probability head, and every
unrelated model layer remain authoritative.

## Fixed candidate

The existing writer has prospectively stored a target-excluded market-aware
Total shadow since the preceding core release. The fixed candidate uses that
Total only when its direction agrees with the already-authoritative Total
forecast. It combines that Total with the incumbent projected margin:

```text
home_score = (market_aware_total + incumbent_margin) / 2
away_score = (market_aware_total - incumbent_margin) / 2
```

This preserves the model's winner and margin by construction. If calibration
is disabled, the market Total is missing, the candidate lands exactly on the
line, or its direction conflicts with the authoritative forecast, the incumbent
score remains unchanged. The selection has no access to a result or evaluated
side price.

## Release-pure forward evidence

The SELECT-only audit deduplicated games and included only immutable locked
rows stamped with the exact preceding projection core. Launch rows and every
other projection release were excluded.

| Candidate | Games | Team-score MAE | Total MAE | Margin MAE | Winner accuracy | Total direction |
|---|---:|---:|---:|---:|---:|---:|
| Independent | 302 | 2.507445 | 3.610624 | 3.239526 | 59.27% | 49.67% |
| Published incumbent | 302 | 2.403725 | 3.435397 | 3.112815 | 60.00% | 51.16% |
| Coherent market-aware Total, incumbent margin | 302 | **2.342682** | **3.302318** | **3.112815** | **60.00%** | 51.83% |

The candidate improved team-score and Total MAE in every chronological
partition while leaving margin MAE and winner accuracy identical:

| Partition | Games | Team MAE incumbent→candidate | Total MAE incumbent→candidate |
|---|---:|---:|---:|
| Sep 2–10 | 97 | 2.330155→2.264485 | 3.680928→3.525773 |
| Sep 11–18 | 109 | 2.384358→2.351239 | 2.996055→2.974587 |
| Sep 19–26 | 96 | 2.500052→2.411979 | 3.686146→3.448646 |

The exact audit command is:

```bash
npx tsx --env-file=.env.local scripts/operator/audit-mlb-current-score-projection.ts \
  2026-09-02 2026-09-26 mlb_projection_core_v2_4_evaluation_only_price_exclusion_2026_09_02
```

## Same-input board impact

A dry run of the September 26 13-game slate compared calibration disabled with
the candidate enabled on otherwise identical inputs. Seven score projections
changed. Total sides, grades, probabilities, confidence, promotions,
demotions, and actionable counts changed zero. This is therefore not a hidden
flattening or grade-threshold release; no paired promotion is required because
the candidate makes no actionable demotion.

## Ownership, validation, and rollback

`lib/services/automodelService.ts` remains the sole score writer and
`lib/services/predictionRecordService.ts` remains the sole member-record
writer under the existing `prediction_pipeline:mlb` lease. The change adds no
provider call, query, timer, or database write. Existing target-excluded slate
inputs and failure behavior are unchanged.

Before merge, run the MLB core/pipeline/prediction-record tests, TypeScript,
lint, `npm run verify:model-change`, the production build, and integration
safety against the latest remote main. After merge, verify the production
commit, one natural writer cycle, the v2.5 projection stamp, score/side
coherence, current odds/stats/split coverage, an empty released lease, member
reader parity, lock immutability, and normal site responsiveness.

Rollback the projection core and schema to v2.4/v16 if a new unlocked row
mixes releases, changes a non-score decision field, rewrites a lock, loses a
price or required input, collapses the board, creates writer overlap, increases
runtime materially, or disagrees with the member reader. Preserve all v2.5
locked rows as immutable release evidence.
