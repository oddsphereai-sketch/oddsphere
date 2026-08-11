# MLB Total Under SharpAPI source alignment — r33

Date: 2026-08-11

Scope: MLB full-game Total low-ticket-resistance Lean only

Decision release: `mlb_daily_edge_decision_2026_08_11_r33`

Rule bundle: `mlb_daily_edge_rule_bundle_v32_2026_08_11`

Grade policy: `mlb_public_grade_policy_v24_sharpapi_total_source_alignment_2026_08_11`

## Finding

The r30 discovery cohort used the latest selected-side SharpAPI split at the historical locked
timestamp. Its first production resolver instead consumed the legacy aggregate split row used by
several older reader rules. That row can be sourced from a different provider, so it was not the
same feature contract as the validated cohort.

The mismatch did not affect the August 11 board: the sleeve had zero live qualifiers before and
after correction. It could, however, have allowed a future promotion based on unvalidated
consensus percentages.

## Correction

The r33 resolver reads the selected side from the source-aware split package passed through the
sole prediction-record writer and requires `provider=sharpapi`. Missing SharpAPI, Playbook-only,
wrong-side, or incomplete split rows fail closed. The rule's side, model, EV, projection, price,
quality, hold, and no-bet gates are unchanged. Moneyline, first inning, probabilities,
projections, stakes, and existing grades are unchanged.

The historical market family remains 36 incremental rows at 28-6-2, +18.467 units and +51.3%
ROI through August 8. The newly reconstructed August 9-10 history added zero family qualifiers,
so it neither strengthens nor weakens that result. The narrower production guard remains a Lean,
not a Best Angle, and must accumulate forward r33 results before any further promotion.

## Verification and rollback

Focused tests prove that a complete SharpAPI pair can activate the sleeve, a ticket share above
35% cannot, and an otherwise identical Playbook-only pair cannot. The full model-change verifier,
TypeScript check, production build, live release coherence, and member-reader snapshot must pass
before r33 is declared live.

Rollback if a non-SharpAPI row activates the sleeve, the August 11 board changes because of this
correction, any market outside the sleeve changes, or live prediction records carry mixed release
stamps.
