# MLB projected-lineup continuity — October 7, 2026

## Scope and predeclaration

This repair is limited to the existing MLB projected-lineup ingestion path. It
does not change a projection coefficient, probability head, side selector,
market-reading rule, grade, stake, member copy, label, layout, provider, request
cadence, writer, lease, lock, tracking row, or settlement rule.

The confirmed defect was destructive replacement: a successful provider request
was added to the deletion set before response completeness or player/team mapping
was established. A `200` response containing zero rows could therefore delete a
previously verified lineup. A partial response could replace a complete lineup
with only the subset that happened to map.

The release is intentionally narrow:

- require at least eight unique mapped batters and eight unique batting positions
  for one exact game/team before replacement;
- publish that complete unit before removing stale projected rows;
- retain all prior rows on empty, malformed, wrong-team, or incomplete input;
- do not allow projected input to downgrade an already complete official lineup;
- keep the existing official MLB overlay authoritative;
- add no provider or database read per card and no second writer.

## Release identity

- Model-layer schema: `mlb_model_layer_versions_v20_projected_lineup_continuity`
- Input eligibility: `mlb_input_eligibility_v2_projected_lineup_last_verified_continuity_2026_10_07`
- Decision release remains `mlb_daily_edge_decision_2026_10_05_r90_corroborated_total_opposition` because selection behavior is unchanged.

New unlocked prediction records receive the new model-layer and input-policy
identity. Existing locked records retain their original releases and values.

## Board impact

For complete exact-team input, the accepted batting unit is unchanged, so the
same-input impact is zero side changes, zero promotions, zero demotions, and zero
actionable-count changes. For the predeclared failure cases—empty response,
seven mapped batters, duplicate batting positions, duplicate player identities,
wrong-team rows, or an already complete official unit—the candidate performs no
replacement. The intended impact is continuity of the preceding coherent board,
not a new prediction or a flatter board.

## Required validation

- Pure fixture coverage for complete, empty, partial, duplicate, wrong-team, and
  already-confirmed units.
- TypeScript compilation and the MLB pipeline safety suite.
- Full `npm run verify:model-change` from a clean committed worktree.
- Current-main integration safety and protected-PR checks.
- Live proof that a complete projected unit publishes, a partial/empty provider
  result retains prior rows, the official overlay remains authoritative, current
  release identifiers are coherent, and existing T-60 locks do not change.

## Rollback

Revert the projected-lineup continuity commit and restore model-layer schema v19
plus input-eligibility policy v1. Do not rewrite any locked row during rollback.
