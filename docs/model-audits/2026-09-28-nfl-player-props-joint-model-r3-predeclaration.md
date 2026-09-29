# NFL player props joint outcome model r3 predeclaration

Date: 2026-09-28
Production base: `9f7c3300f642b18084f93ca2e852696ef4defbc1`

## Scope

This audit covers the NFL player-props projection and distribution family for passing attempts,
passing completions, passing yards, rushing attempts, rushing yards, receptions and receiving
yards. It includes the existing target-book-excluded market-reading layer, exact-price decision
and grade calibration, canonical board/member readers, the sole NFL forward-evidence writer, and
the existing `prediction_pipeline:nfl` lease. It does not change member copy, labels, layout,
stakes, provider schedules, provider request ceilings, locking semantics, settlement, or the
Daily Edge game model.

## Current champion

- model: `nfl_player_props_distribution_model_2026_09_28_r12_qb_workload_marriage`
- calibration: `nfl_player_props_distribution_calibration_2026_09_28_r13_qb_workload_marriage`
- decision: `nfl_player_props_decision_2026_09_28_r16_qb_workload_marriage`
- runtime: `nfl_player_props_runtime_2026_09_28_r17_qb_workload_marriage`
- board: `nfl_player_props_board_2026_09_28_r20_qb_workload_marriage`
- member: `nfl_player_props_member_2026_09_28_r27_qb_workload_marriage`
- writer: `nfl_player_props_writer_2026_09_28_r32_qb_workload_marriage`

The sole writer remains the existing NFL forward-evidence job under the shared sport-scoped
lease. No second writer, timer or per-card provider request is allowed.

## Problem statement

The current runtime fits and adjusts passing attempts, completions and yards independently.
That permits internally impossible workload states, including a completion projection nearly
equal to the attempt projection. The same structural weakness exists in the opportunity/efficiency
relationship for receiving and rushing markets. Threshold or grade-only changes cannot repair the
underlying projection error.

## Candidate architecture

The candidate will use a coherent generative hierarchy rather than unrelated point heads:

1. participation and role probability;
2. team opportunity volume;
3. player opportunity allocation (QB attempts, carries or targets);
4. conditional efficiency (completion rate, yards per completion/carry/reception);
5. one joint simulated outcome distribution whose marginal projections and probabilities remain
   mathematically compatible.

Current market evidence remains source-separated and target-book-excluded. It may update latent
opportunity or efficiency only when the historical/forward evaluation supports that channel.
Evaluated price stays downstream for EV and grading. Missing market evidence is unavailable, not
neutral or fabricated, and may not override lineup, identity, freshness or exact-price gates.

## Frozen evaluation plan

- Training: 2016-2022 regular seasons.
- Architecture selection: 2023.
- Confirmation: 2024.
- Untouched point/distribution holdout: 2025.
- Market/grade evaluation: release-pure locked 2026 forward observations only.
- Current-slate impact: exact same captured offers and context for incumbent and candidate.

Report per market MAE, RMSE, bias, distributional loss and interval coverage. For the joint QB
head also report completion/attempt coherence and passing-yards identity error. Directional and
grade results must be clustered by player/game, separated by exact release and lock timestamp,
and include record, units/ROI, Brier/log loss, calibration gap, actionable counts, promotions,
demotions and market mix. The candidate must preserve all eligible games and offers.

## Promotion rule

The candidate may replace the champion only when it materially improves held-out projection or
distribution accuracy without creating a meaningful regression in another affected market, fixes
joint coherence by construction, and retains a usable action board. Any grade demotion rule must
have a tested promotion path; hidden flattening is a rejection. Insufficient market/grade evidence
cannot be converted into a live grade claim.

## Load, publication and rollback

The runtime must reuse the existing slate-level feature and offer bundles and must not add provider
calls. Publication must use new immutable releases through the existing clean PR and writer path.
Locked rows stay immutable. Preserve the last coherent member snapshot on failure.

Hold or roll back if releases mix, any eligible market disappears, projections violate joint
identities, required price/context is presented as a normal model evaluation, actionables collapse
without balanced replacements, provider/database load increases unexpectedly, the writer overlaps
or times out, or the live reader does not match the verified candidate.
