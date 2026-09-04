# MLB full-game Total SharpAPI support scope correction (r82)

Status: predeclared correctness correction; full-game Moneyline and first inning are out of scope.

## Defect and frozen contract

The published r37 validation contract authorizes the SharpAPI money-over-tickets support Lean for
selected-side **Unders only**. Its recorded train/validation/holdout result was 17-5, while the
corresponding Over branch was explicitly rejected after going 6-6 in both validation and holdout.
The production resolver nevertheless accepted either `over` or `under` under the same immutable
v1 rule identifier. That is a runtime/registry mismatch, not a new outcome-derived threshold.

Before editing runtime behavior, the correction was frozen as follows:

- retain the existing Under eligibility, price, movement, split-gap, quality, side, probability,
  price-selection, lock, stake, provider, and writer behavior byte-for-byte;
- reject Over from this one Under-validated sleeve, without changing the modeled side;
- stamp a new full-game decision/rule/grade identity and a new rule identifier;
- leave every first-inning model, probability, grade, release identifier, and tuple unchanged.

## Board and balance requirement

This is a scope-enforcement correction, not a new demotion search. Its paired promotion path is the
already validated Under branch, which remains active and is covered by the same focused regression.
The required board comparison must report every removed unsupported Over promotion and every
preserved eligible Under promotion. No replacement Over promotion may be invented to satisfy a
board quota. If the current-board comparison unexpectedly changes any Moneyline, first-inning,
modeled side, probability, price, stake, or non-sleeve Total grade, publication is blocked.

## Release identity and rollback

- decision: `mlb_daily_edge_decision_2026_09_04_r82_total_support_under_scope`
- rule bundle: `mlb_daily_edge_rule_bundle_v70_total_support_under_scope_2026_09_04`
- grade policy: `mlb_public_grade_policy_v57_total_support_under_scope_2026_09_04`
- corrected sleeve: `total_sharpapi_money_over_tickets_support_lean_v2_under_only_2026_09_04`

Rollback restores r82/v70/v57 and the v1 resolver. Locked historical rows remain immutable and
continue to carry the release and rule that actually produced them.

## Verification gates

Publication requires the focused prediction-record regression (including explicit Over rejection
and Under preservation), a release-separated current-board comparison, TypeScript, the full model
safety suite, build, latest-main integration safety, protected pull request, and live full-game
release proof. Failure or first-inning drift keeps this correction unpublished.
