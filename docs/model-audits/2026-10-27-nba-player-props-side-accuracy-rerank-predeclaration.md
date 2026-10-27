# NBA player-props side-accuracy rerank predeclaration

Date: 2026-10-27

## Problem

The member board appeared Under-heavy, but a direction-only intervention would
be cosmetic and could reduce accuracy. The audit therefore separates the
independent projection, market-reading side, and exact-price grade selection by
market and release. It may change only which already-computed future-unlocked
rows receive Best Angle or Lean. It may not change a projection, side,
probability, price, stake, writer, cadence, UI, or locked row.

## Frozen selection and confirmation

Candidate signal family and an Over offset are selected independently by market
on the existing reliability-fit and grade-policy windows. A market qualifies
only if the identical frozen rule also improves its separate confirmation
window. Current-release settled locks are an additional forward check, not a
selection input.

Every affected slate/market must retain the exact incumbent actionable count
and exact Best Angle count. Every promotion must be paired with a demotion.
Promotions require genuine target-book-excluded evidence from at least one
other book and a price of -200 or better. Missing evidence cannot promote a
row. Markets that fail confirmation remain unchanged.

## Release boundary

Candidate artifact / decision / grade releases:

- `nba_player_props_frozen_runtime_artifact_2026_10_27_r12_side_accuracy_rerank`
- `nba_player_props_forward_decision_2026_10_27_r13_side_accuracy_rerank`
- `nba_player_props_exact_price_grade_2026_10_27_r14_side_accuracy_rerank`

Only Points, Assists, and Points + Assists are eligible. Rebounds failed the
confirmation gate and is explicitly excluded. All other markets remain exact.

## Required gates

- release-pure historical selection and confirmation;
- exact stored-lock forward replay with runtime-parity probability math;
- unchanged actionable and Best Angle counts within every affected
  slate/market;
- paired promotions and demotions;
- no projection, side, probability, price, or locked-record changes;
- focused NBA player-props tests, TypeScript, `npm run verify:model-change`,
  integration safety, protected PR checks, and live release verification.

