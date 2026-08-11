# MLB Moneyline SharpAPI source alignment — r34

Date: 2026-08-11

Decision release: `mlb_daily_edge_decision_2026_08_11_r34`

Rule bundle: `mlb_daily_edge_rule_bundle_v33_2026_08_11`

Grade policy: `mlb_public_grade_policy_v25_sharpapi_split_source_alignment_2026_08_11`

## Finding

The signed Moneyline split rule and the r32 Moneyline portfolio ranker were validated with the
latest selected-side SharpAPI observations at or before lock. Their first production paths read
`public_splits`, the legacy aggregate snapshot. That row often mirrors SharpAPI, including the
three August 11 signed stand-downs, but its provider is not contractually fixed and it can instead
reflect another upstream aggregation. The implementation therefore did not guarantee the same
input semantics as the validation.

## Correction

r34 keeps side selection, projection, probability, price selection, movement, stakes, and every
older correction/conflict rule unchanged. Only the newer SharpAPI-validated split decisions move
to the frozen `source_aware_split_rows_at_lock` package:

- signed money-minus-ticket promotion and stand-down;
- r32 top-one Moneyline portfolio score.

Both paths use the final selected side and `provider=sharpapi`. Missing SharpAPI values fail
closed. A complete Playbook-only pair cannot promote, demote, or enter the portfolio score.
Decision audit objects stamp `split_provider=sharpapi` when the signed rule fires.

## Evidence boundary

This is a source-contract correction, not a new threshold search. The existing signed-rule paired
replay and r32 release-separated portfolio evidence remain the applicable performance evidence
because those audits already used SharpAPI observations. No historical result is reclassified as
current-release performance.

The paired August 11 replay produced all 45 expected records for 15 games, skipped no held market,
and stamped the exact r34 identifiers. The full-game actionable set remained Pittsburgh
Moneyline, Tampa Bay Under, and New York Mets/Atlanta Under. All 15 selected-side Moneyline
SharpAPI comparisons preserved the same signed threshold decision as the aggregate row; the
portfolio selection remained Pittsburgh and now stamps `split_provider=sharpapi`. Unrelated
live-input drift changed a non-actionable Baltimore/Minnesota side in the fresh dry-run, but the
source correction itself added or removed no actionable full-game recommendation.

Focused fixtures require complete SharpAPI inputs and prove that legacy aggregate or
Playbook-only values cannot substitute. The broader execution-price audit also rejected a tempting
unified shortcut: promoting a non-actionable row merely because a better same-line book price
crossed +1% model EV went 2-5 in development, 0-1 in validation, and 0-3 in holdout. That behavior
remains research-only and does not affect r34.

## Rollback

Rollback is the r33 commit. Do not restore only the legacy split reads while retaining the r34
identifier. Any rollback must restore the complete prior runtime/version set and then rerun the
authoritative prediction writer under the shared MLB `prediction_pipeline` lease.
