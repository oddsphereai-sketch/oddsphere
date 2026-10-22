# NBA player props structural v2 result

Date: 2026-10-22  
Status: private forward release only; member/public output remains disabled

## Predeclared objective

Improve projection and direction accuracy across the existing eight-market NBA
player-prop product without hiding misses, flattening the actionable board, or
changing the member-facing surface. Preserve locked records and the single NBA
`prediction_pipeline` writer/lease.

## Data and chronology

- Immutable dataset:
  `nba_player_props_historical_research_dataset_2026_10_21_r5_opportunity_context_exact_prices`
- Input SHA-256:
  `68c71ef30494811a94b53a1a3d873947b65a49a20af2e1743c1038023ecf385f`
- 360 chronological games and 5,581 point-in-time feature rows.
- Windows: 180 development, 36 model selection, 35 reliability fit, 37 grade
  policy, and 72 untouched confirmation games.
- Opening-price observations only. Same-book intraday movement remains a
  release-pure private-forward validation responsibility.

## Accepted model changes

1. Hyperparameters remain selected on chronological train/validation windows,
   but the frozen component model is then refit on all legal pre-cutoff rows.
   Validation metrics still use the selection-only fit; no future outcome is
   introduced.
2. Rebounds use a robust opportunity/count model with rotation-aware minute
   inputs and iteratively reweighted ridge fitting. It improved untouched
   rebound projection MAE from 2.22 to 2.12 and broad direction from 50.66% to
   52.21%.
3. The prior confirmed grade policies are preserved. The only promotion change
   is a one-per-slate points+rebounds Lean ranked by target-price probability.
   It was selected before confirmation and went 5-2 on the untouched block.
4. Target-book-excluded market evidence, coherent projection/side enforcement,
   and the member-disabled gate remain unchanged.

## Rejected candidates

- A learned market residual correction reduced MAE but created an extreme Over
  bias and only 50.03% weighted direction.
- A role-segmented mixture of experts confirmed at 52.21%, below the champion.
- Extra Trees and player-specific residual shrinkage failed market-level
  confirmation. None entered the frozen runtime.

## Untouched confirmation result

| Measure | Prior release | Candidate |
|---|---:|---:|
| Exact-price direction | 52.62% | 52.92% |
| Independent direction | 50.96% | 51.75% |
| All-pick units | -95.14 | -82.74 |
| Actionable count | 133 | 137 |
| Actionable record | 84-49 | 87-50 |
| Actionable hit rate | 63.16% | 63.50% |
| Actionable units | +20.44 | +22.20 |
| Actionable ROI | +15.37% | +16.21% |
| Best Angle record | 20-8 | 21-8 |
| Lean record | 64-41 | 66-42 |

Board impact is +4 net actionables; the release does not flatten the board.

The first post-merge production invocation correctly failed closed before
publishing because the server bundle changed imported JSON object insertion
order and the r2 runtime hashed `JSON.stringify` output directly. R3 replaced
that packaging-sensitive check with recursive canonical key ordering. Local
source and optimized server bundles then matched exactly, but the hosted
runtime still rejected the artifact, exposing a second dependency on decimal
number rendering across Node/V8 runtimes. R4 replaces textual number rendering
with an exact IEEE-754 binary encoding while retaining recursive key ordering,
array order, string identity, and fail-closed validation. The artifact payload,
selected models, projections, probabilities, sides, grades, provider cadence,
writer, lease, public gate, and locked rows are otherwise unchanged.

## Releases and rollback

- Frozen artifact:
  `nba_player_props_frozen_runtime_artifact_2026_10_22_r4_binary_checksum`
- Decision:
  `nba_player_props_forward_decision_2026_10_22_r4_binary_checksum_disabled`
- Model:
  `nba_player_props_model_tournament_2026_10_22_r12_robust_rebounds_full_refit`
- Grade/calibration:
  `nba_player_props_exact_price_grade_2026_10_22_r11_preserved_plus_pr_promotion`
- Product:
  `nba_player_props_product_candidate_2026_10_22_r5_private_forward_ready`

Rollback restores the r1 frozen artifact and r4 product release. No locked row
is rewritten by either activation or rollback.
