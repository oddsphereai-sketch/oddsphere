# NFL prediction-owned side and tracking correction — 2026-09-14

## Incident and predeclared invariant

The NFL outcome forecast is holistic: the team above 50% win probability is the published winner. Exact sportsbook price and target-excluded value evidence may determine whether that winner is Best Angle, Lean, Watchlist, or No Play, but must never replace it with the opposing team. Tracking must settle that same published side. Every complete locked side-bearing Moneyline, Spread, and Total forecast belongs in prediction accuracy, including No Play; loss of an exact price cannot turn the prediction into Held or remove it from the denominator.

The repair was selected from release identity, immutable publication evidence, checksums, timestamps, and forecast/pick coherence before results were consulted. Results are reported only after the correction mapping was fixed.

## Root cause

The r12 Moneyline decision path separately evaluated the underdog price and could select it when target-excluded EV and edge cleared thresholds, even though the outcome forecast predicted the favorite. That selected-price side propagated to immutable tracking. The member presentation could therefore retain a prediction pill for one team while Quick Read and tracking represented the opponent.

The movement renderer had a separate presentation defect: it could trust a stale writer direction before comparing the two visible prices on the selected side. That allowed -200 to -250 to be labeled adverse even though selected-side implied probability increased.

## Audited evidence

The dry-run operator audit read the locked NFL records, verified their evidence checksums, required an on-time T-60 capture, and compared each stored side to the immutable published forecast in its snapshot.

- Records checked: 45; evidence/checksum matches: 45.
- Moneylines checked: 15; mismatches: 6.
- Spreads checked: 15; mismatches: 0.
- Totals checked: 15; mismatches: 0.
- Mismatched Moneylines: SF@LAR (SF→LAR), NO@DET (NO→DET), BAL@IND (IND→BAL), ATL@PIT (ATL→PIT), CHI@CAR (CAR→CHI), and WSH@PHI (WSH→PHI).
- Every corrected prediction-side price grades No Play: LAR -200, DET -325, BAL -148, PIT -295, CHI -160, and PHI -245.

The correction guard fails closed unless the audited population remains exactly 45 records, six Moneyline-only mismatches, and all checksum/time/release invariants pass.

## Production releases

- Member/model/calibration/decision/policy: `nfl_v1_member_release_2026_09_14_r13_prediction_owned_side`, `nfl_v1_daily_edge_model_2026_09_14_r10_prediction_owned_side`, `nfl_v1_daily_edge_calibration_2026_09_14_r10_prediction_owned_side`, `nfl_v1_daily_edge_decision_2026_09_14_r16_prediction_owned_side`, `nfl_v1_grade_policy_2026_09_14_r16_prediction_owned_side`.
- Target-exclusion resolver: `nfl_target_excluded_market_outcome_2026_09_14_r2_prediction_owned_side`.
- Snapshot/writer/fixture: `nfl_forward_member_snapshot_2026_09_14_r10_prediction_owned_side`, `nfl_forward_evidence_writer_2026_09_14_r25_prediction_owned_side`, `nfl_weekly_member_fixture_2026_09_14_r18_prediction_owned_side`.
- Tracking lifecycle/bundle/boundary/record: `nfl_tracking_lifecycle_2026_09_14_r10_prediction_owned_side`, `nfl_tracking_composite_release_bundle_2026_09_14_r6_prediction_owned_side`, `nfl_evaluated_tuple_tracking_boundary_2026_09_14_r7_prediction_owned_side`, `nfl_official_tracking_record_2026_09_14_r7_prediction_owned_side`.
- Correction/aggregate: `nfl_published_tracking_correction_2026_09_14_r1_prediction_owned_side`, `nfl_tracking_prediction_side_correction_2026_09_14_r1`, `tracking_aggregate_v9_append_only_correction_precedence_2026_09_14`.

One exported prediction-owned Moneyline selector now serves live decisions and correction generation. The existing `nfl-forward-evidence` job remains the only prediction writer and retains the `prediction_pipeline:nfl` lease.

## Outcome-blind impact and post-hoc results

On the audited 15 Moneylines, actionables move 10→4: six demotions, zero promotions. The full prediction denominator remains 15. This board contraction is accepted and visible because the six removed actions opposed the product's own winner forecast; no compensating promotion or quota was manufactured. The paired actionable promotion rule remains active and is tested directly: a prediction-owned winner with two target-excluded comparators, bounded price, nonnegative EV, and nonnegative consensus edge becomes Lean. None of the six corrected rows qualifies for it.

After the correction mapping was frozen, attaching results changes Moneyline accuracy from the erroneous selected-price-side 6-9 to the published prediction-side 10-5. Sunday changes from 4-9 to 9-4. This result difference did not select the corrected sides.

## Complete tracking and No Play semantics

A complete on-time three-market outcome manifest is tracking-eligible even when it contains zero exact-price decisions. The record builder emits one side-bearing non-Held No Play for each of Moneyline, Spread, and Total, with null price, market probability, edge, EV, recommendation, and stake. Such rows count only in prediction accuracy and cannot enter actionable cuts or ROI. A missing side, incoherent forecast, invalid identity, late lock, unapproved release, or true whole-game failure remains ineligible.

Historical corrections are append-only. Each correction identifies the superseded original, preserves the original evidence snapshot with explicit correction metadata, and uses the published forecast probability plus the real contemporaneous prediction-side price. Original rows are never changed or deleted. Public aggregates and the admin winner scorecard remove a superseded original only when its explicit correction is present. If mutable game-score context is no longer sufficient to settle the appended row, the operator uses the already-settled immutable source grade only after side selection: an exact opposite-side Moneyline maps win↔loss while push and void remain unchanged. A pending source fails closed.

## Movement invariant

Movement is computed from selected-side American odds through implied probability. Positive selected-side probability change is supportive and negative change is adverse. Therefore -200→-250 and +105→-105 are supportive; their reverses are adverse. For a same-line visible price trail, this calculation owns the label and a stored writer direction cannot override it.

## Verification and rollback

Required verification includes TypeScript, the expanded NFL production suite, Daily Edge experience assertions, aggregate/admin correction precedence, the line-movement matrix, the read-only immutable-record audit, and `npm run verify:model-change`. Publication must pass the clean-worktree current-main ancestor check and protected PR checks. After deployment, the correction audit runs once with `--apply`, grades the correction rows, proves source rows unchanged, and is safe to rerun idempotently.

Rollback the complete r13 family together. Do not delete either the original or correction records. Preserve the correction precedence unless a new explicit evidence audit supersedes it; otherwise the public page would knowingly restore the incoherent side. A rollback may stop future corrections but cannot rewrite locked history.
